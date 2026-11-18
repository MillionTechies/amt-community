"""Connected accounts, against fake Google, Microsoft and Zoom servers."""

import base64
import json
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from django.core import mail
from django.utils import timezone

from apps.integrations import providers, service
from apps.integrations.models import Connection, EventLink
from tests.test_events import create_event


def id_token(email):
    claims = base64.urlsafe_b64encode(json.dumps({"email": email}).encode()).decode().rstrip("=")
    return f"header.{claims}.signature"


class FakeProviders:
    """Answers like the real APIs, and records what was asked."""

    def __init__(self):
        self.calls = []
        self.token_calls = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.calls.append((request.method, url, request))
        body = json.loads(request.content) if request.content and request.headers.get("content-type", "").startswith("application/json") else {}
        if "oauth2.googleapis.com/token" in url or "login.microsoftonline.com" in url or "zoom.us/oauth/token" in url:
            self.token_calls += 1
            return httpx.Response(200, json={
                "access_token": f"access-{self.token_calls}", "refresh_token": "refresh-1",
                "expires_in": 3600, "id_token": id_token("alice@work.example"),
            })
        if url.startswith("https://www.googleapis.com/calendar") and request.method == "POST":
            meet = {"hangoutLink": "https://meet.google.com/abc-defg-hij"} if "conferenceData" in body else {}
            return httpx.Response(200, json={"id": "g-1", **meet})
        if url.startswith("https://graph.microsoft.com") and request.method == "POST":
            teams = {"onlineMeeting": {"joinUrl": "https://teams.microsoft.com/l/meetup-join/xyz"}} if body.get("isOnlineMeeting") else {}
            return httpx.Response(201, json={"id": "ms-1", **teams})
        if url == "https://api.zoom.us/v2/users/me":
            return httpx.Response(200, json={"email": "alice@zoom.example"})
        if url.startswith("https://api.zoom.us/v2/users/me/meetings"):
            return httpx.Response(201, json={"id": 987, "join_url": "https://us02web.zoom.us/j/987"})
        if request.method in ("PATCH", "DELETE"):
            return httpx.Response(204 if request.method == "DELETE" else 200, json={} if request.method == "PATCH" else None)
        return httpx.Response(404, json={"error": "unexpected"})

    def last(self, method, contains):
        return next(c for c in reversed(self.calls) if c[0] == method and contains in c[1])


@pytest.fixture
def fake(monkeypatch, settings):
    for name in ("GOOGLE", "MICROSOFT", "ZOOM"):
        setattr(settings, f"{name}_OAUTH_CLIENT_ID", f"{name.lower()}-client")
        setattr(settings, f"{name}_OAUTH_CLIENT_SECRET", "secret")
    server = FakeProviders()
    monkeypatch.setattr(providers, "http", lambda: httpx.Client(transport=httpx.MockTransport(server)))
    return server


def connect(client, provider_id):
    start = client.post(f"/api/integrations/{provider_id}/")
    assert start.status_code == 200, start.content
    query = parse_qs(urlparse(start.json()["authorize_url"]).query)
    assert query["redirect_uri"] == [f"http://localhost:8000/api/integrations/{provider_id}/callback/"]
    return client.get(f"/api/integrations/{provider_id}/callback/", {"code": "the-code", "state": query["state"][0]})


def test_providers_need_setting_up(admin, settings):
    settings.GOOGLE_OAUTH_CLIENT_ID = ""
    listed = {p["id"]: p for p in admin.get("/api/integrations/").json()}
    assert listed["google"]["configured"] is False and listed["google"]["connected"] is False
    assert admin.post("/api/integrations/google/").status_code == 400


def test_connecting_an_account(admin, fake):
    back = connect(admin, "google")
    assert back.status_code == 302 and back["Location"].endswith("/manage/integrations?connected=google")
    connection = Connection.objects.get(provider="google")
    assert connection.account_email == "alice@work.example"
    assert connection.access_token == "access-1" and "access-1" not in connection.access_token_sealed
    listed = {p["id"]: p for p in admin.get("/api/integrations/").json()}
    assert listed["google"]["connected"] and listed["google"]["account_email"] == "alice@work.example"

    assert admin.delete("/api/integrations/google/").status_code == 204
    assert not Connection.objects.exists()


def test_a_forged_state_is_refused(admin, fake):
    back = admin.get("/api/integrations/google/callback/", {"code": "x", "state": "forged"})
    assert back["Location"].endswith("?error=google") and not Connection.objects.exists()


def test_google_meet_becomes_the_join_link_and_follows_changes(admin, bob, org, fake):
    connect(admin, "google")
    event = create_event(admin, org, delivery_mode="in_person", online_url="")
    bob.post(f"/api/events/{event['slug']}/register/")
    mail.outbox.clear()

    made = admin.post(f"/api/events/{event['slug']}/links/", {"provider": "google", "meeting": True}, format="json")
    assert made.status_code == 201, made.content
    assert made.json()["join_url"] == "https://meet.google.com/abc-defg-hij"
    detail = admin.get(f"/api/events/{event['slug']}/").json()
    assert detail["online_url"] == "https://meet.google.com/abc-defg-hij"
    assert detail["delivery_mode"] == "hybrid" and detail["meeting_provider"]["name"] == "Google Meet"
    assert mail.outbox and mail.outbox[0].subject.startswith("Updated:")  # attendees get the link

    admin.patch(f"/api/events/{event['slug']}/", {"title": "Renamed"}, format="json")
    method, url, request = fake.last("PATCH", "calendars/primary/events/g-1")
    assert json.loads(request.content)["summary"] == "Renamed"

    admin.post(f"/api/events/{event['slug']}/transition/", {"status": "cancelled"}, format="json")
    assert fake.last("DELETE", "calendars/primary/events/g-1")
    assert not EventLink.objects.exists()


def test_teams_and_zoom_meetings(admin, org, fake):
    connect(admin, "microsoft")
    connect(admin, "zoom")
    event = create_event(admin, org)
    teams = admin.post(f"/api/events/{event['slug']}/links/", {"provider": "microsoft", "meeting": True}, format="json")
    assert teams.json()["join_url"].startswith("https://teams.microsoft.com/")

    zoom = admin.post(f"/api/events/{event['slug']}/links/", {"provider": "zoom", "meeting": True}, format="json")
    assert zoom.json()["join_url"] == "https://us02web.zoom.us/j/987"
    assert admin.get(f"/api/events/{event['slug']}/").json()["meeting_provider"]["name"] == "Zoom"
    # Zoom wants the client credentials as Basic auth.
    token_request = fake.last("POST", "zoom.us/oauth/token")[2]
    assert token_request.headers["authorization"].startswith("Basic ")
    assert Connection.objects.get(provider="zoom").account_email == "alice@zoom.example"


def test_calendar_only_copy_and_removing_it(admin, org, fake):
    connect(admin, "microsoft")
    event = create_event(admin, org)
    link = admin.post(f"/api/events/{event['slug']}/links/", {"provider": "microsoft"}, format="json").json()
    assert link["is_meeting"] is False and link["join_url"] == ""
    sent = json.loads(fake.last("POST", "graph.microsoft.com")[2].content)
    assert "isOnlineMeeting" not in sent and sent["subject"] == "Intro to APIs"

    assert admin.delete(f"/api/events/{event['slug']}/links/{link['id']}/").status_code == 204
    assert fake.last("DELETE", "graph.microsoft.com/v1.0/me/events/ms-1")


def test_expired_tokens_are_refreshed(admin, org, fake):
    connect(admin, "google")
    connection = Connection.objects.get()
    connection.expires_at = timezone.now() - timedelta(minutes=1)
    connection.save()
    assert service.token_for(connection) == "access-2"
    assert parse_qs(fake.last("POST", "oauth2.googleapis.com/token")[2].content.decode())["grant_type"] == ["refresh_token"]


def test_only_organisers_link_events(admin, bob, org, fake):
    event = create_event(admin, org)
    assert bob.post(f"/api/events/{event['slug']}/links/", {"provider": "google"}, format="json").status_code == 403
    no_account = admin.post(f"/api/events/{event['slug']}/links/", {"provider": "google"}, format="json")
    assert no_account.status_code == 400 and "Connect your Google account" in no_account.json()[0]
