"""Connected accounts, against fake Google, Microsoft and Zoom servers."""

import base64
import json
import threading
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from django.core import mail
from django.utils import timezone

from apps.configuration.models import Setting, seal
from apps.events.models import Event
from apps.integrations import background, calendar, providers, service
from apps.integrations.models import Connection, EventLink
from tests.conftest import sign_in
from tests.test_events import create_event


def id_token(email):
    claims = base64.urlsafe_b64encode(json.dumps({"email": email}).encode()).decode().rstrip("=")
    return f"header.{claims}.signature"


class FakeProviders:
    """Answers like the real APIs, and records what was asked."""

    def __init__(self):
        self.calls = []
        self.token_calls = 0
        # Extra fields for (or, as None, removals from) the token endpoint's answer.
        self.token_overrides = {}
        # (method, part of the URL) pairs the provider fails with a 500.
        self.failing = set()

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.calls.append((request.method, url, request))
        body = json.loads(request.content) if request.content and request.headers.get("content-type", "").startswith("application/json") else {}
        if any(request.method == method and part in url for method, part in self.failing):
            return httpx.Response(500, json={"error": "backend error"})
        if "oauth2.googleapis.com/token" in url or "login.microsoftonline.com" in url or "zoom.us/oauth/token" in url:
            self.token_calls += 1
            tokens = {
                "access_token": f"access-{self.token_calls}", "refresh_token": "refresh-1",
                "expires_in": 3600, "id_token": id_token("alice@work.example"), **self.token_overrides,
            }
            return httpx.Response(200, json={k: v for k, v in tokens.items() if v is not None})
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


# --- connecting: the edges ------------------------------------------------------------------


def test_unknown_services_are_not_found(admin):
    assert admin.post("/api/integrations/myspace/").status_code == 404
    assert admin.delete("/api/integrations/myspace/").status_code == 404


def test_only_an_organisations_organisers_connect_to_its_app(bob, org, fake):
    response = bob.post("/api/integrations/zoom/", {"app": org.id}, format="json")
    assert response.status_code == 403
    assert not fake.calls


def test_platform_admins_see_only_the_apps_of_organisations_they_run(admin, org, other_org, fake):
    Setting.objects.create(organization=other_org, key="zoom.client_id", value="uon")
    Setting.objects.create(organization=other_org, key="zoom.client_secret", value=seal("uon-secret"))
    root = sign_in("root", platform_admin=True)
    assert {i["app"] for i in root.get("/api/integrations/").json() if i["id"] == "zoom"} == {None}
    uon_admin = sign_in("root2", platform_admin=True, admin_of=[other_org])
    zoom_apps = {(i["app"], i["app_name"]) for i in uon_admin.get("/api/integrations/").json() if i["id"] == "zoom"}
    assert zoom_apps == {(None, "A Million Techies"), (other_org.id, "UON")}
    # The organisation's own admins do not run other organisations' events.
    assert {i["app"] for i in admin.get("/api/integrations/").json() if i["id"] == "zoom"} == {None}


def test_the_provider_saying_no_sends_the_browser_back_with_an_error(admin, fake):
    back = admin.get("/api/integrations/google/callback/", {"error": "access_denied"})
    assert back.status_code == 302 and back["Location"].endswith("/manage/integrations?error=google")
    assert not fake.calls and not Connection.objects.exists()


def test_a_state_for_another_provider_is_refused(admin, fake):
    start = admin.post("/api/integrations/google/").json()
    state = parse_qs(urlparse(start["authorize_url"]).query)["state"][0]
    back = admin.get("/api/integrations/zoom/callback/", {"code": "the-code", "state": state})
    assert back["Location"].endswith("?error=zoom")
    assert not fake.calls and not Connection.objects.exists()


def test_a_failed_token_exchange_is_refused(admin, fake):
    fake.failing.add(("POST", "oauth2.googleapis.com/token"))
    back = connect(admin, "google")
    assert back["Location"].endswith("?error=google") and not Connection.objects.exists()


def test_reconnecting_keeps_what_the_provider_did_not_send_again(admin, fake):
    connect(admin, "google")
    fake.token_overrides = {"refresh_token": None, "id_token": None}
    connect(admin, "google")
    connection = Connection.objects.get()
    assert connection.access_token == "access-2"
    assert connection.refresh_token == "refresh-1"
    assert connection.account_email == "alice@work.example"
    assert str(connection) == "Alice on Google"


def test_a_refresh_without_a_new_refresh_token_keeps_the_old_one(admin, fake):
    connect(admin, "google")
    fake.token_overrides = {"refresh_token": None, "expires_in": None}
    connection = Connection.objects.get()
    connection.expires_at = timezone.now() - timedelta(minutes=1)
    connection.save()
    assert service.token_for(connection) == "access-2"
    connection.refresh_from_db()
    assert connection.refresh_token == "refresh-1" and connection.expires_at is None


def test_an_expired_connection_without_a_refresh_token_must_be_reconnected(admin, org, fake):
    fake.token_overrides = {"refresh_token": None}
    connect(admin, "google")
    Connection.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
    event = create_event(admin, org)
    response = admin.post(f"/api/events/{event['slug']}/links/", {"provider": "google"}, format="json")
    assert response.status_code == 400
    assert response.json() == ["Your Google connection has expired. Connect it again."]
    assert not EventLink.objects.exists()


# --- an event's copies: the edges -------------------------------------------------------------


def test_organisers_see_whose_copies_they_are(admin, org, fake):
    co = sign_in("dora", admin_of=[org])
    connect(admin, "microsoft")
    event = create_event(admin, org)
    admin.post(f"/api/events/{event['slug']}/links/", {"provider": "microsoft"}, format="json")
    url = f"/api/events/{event['slug']}/links/"
    mine = admin.get(url).json()
    assert [(l["provider"], l["account_email"], l["mine"]) for l in mine] == [("microsoft", "alice@work.example", True)]
    assert [l["mine"] for l in co.get(url).json()] == [False]
    # Only the organiser who added it can remove it.
    assert co.delete(f"{url}{mine[0]['id']}/").status_code == 403
    assert EventLink.objects.exists()


def test_what_each_service_can_make(admin, org, fake, monkeypatch):
    connect(admin, "zoom")
    event = create_event(admin, org)
    url = f"/api/events/{event['slug']}/links/"
    calendar_only = admin.post(url, {"provider": "zoom"}, format="json")
    assert calendar_only.status_code == 400
    assert calendar_only.json() == ["Zoom has no calendar to add events to."]

    monkeypatch.setattr(providers.PROVIDERS["zoom"], "meeting_name", "")
    meeting = admin.post(url, {"provider": "zoom", "meeting": True}, format="json")
    assert meeting.status_code == 400 and meeting.json() == ["Zoom cannot make meetings."]
    assert not EventLink.objects.exists()


def test_cancelled_events_are_not_copied(admin, org, fake):
    connect(admin, "google")
    event = create_event(admin, org)
    admin.post(f"/api/events/{event['slug']}/transition/", {"status": "cancelled"}, format="json")
    response = admin.post(f"/api/events/{event['slug']}/links/", {"provider": "google"}, format="json")
    assert response.status_code == 400 and response.json() == ["This event is cancelled."]
    assert not any(c[0] == "POST" and "calendar" in c[1] for c in fake.calls)


def test_a_provider_failure_is_shown_to_the_organiser(admin, org, fake):
    connect(admin, "google")
    fake.failing.add(("POST", "googleapis.com/calendar"))
    event = create_event(admin, org)
    response = admin.post(f"/api/events/{event['slug']}/links/", {"provider": "google"}, format="json")
    assert response.status_code == 400
    assert response.json() == ["Could not create the Google Calendar event (500): {'error': 'backend error'}"]
    assert not EventLink.objects.exists()


def test_adding_a_copy_again_replaces_the_old_one(admin, org, fake):
    connect(admin, "microsoft")
    event = create_event(admin, org)
    url = f"/api/events/{event['slug']}/links/"
    first = admin.post(url, {"provider": "microsoft"}, format="json").json()
    second = admin.post(url, {"provider": "microsoft"}, format="json").json()
    assert fake.last("DELETE", "graph.microsoft.com/v1.0/me/events/ms-1")
    assert list(EventLink.objects.values_list("id", flat=True)) == [second["id"]]
    assert first["id"] != second["id"]


def test_removing_a_meeting_removes_the_join_link(admin, org, fake):
    connect(admin, "zoom")
    event = create_event(admin, org, delivery_mode="online", venue="")
    link = admin.post(f"/api/events/{event['slug']}/links/", {"provider": "zoom", "meeting": True}, format="json").json()
    assert admin.get(f"/api/events/{event['slug']}/").json()["online_url"] == "https://us02web.zoom.us/j/987"

    assert admin.delete(f"/api/events/{event['slug']}/links/{link['id']}/").status_code == 204
    assert fake.last("DELETE", "api.zoom.us/v2/meetings/987")
    assert admin.get(f"/api/events/{event['slug']}/").json()["online_url"] == ""
    assert not EventLink.objects.exists()


def test_a_failed_removal_keeps_the_copy(admin, org, fake):
    connect(admin, "google")
    event = create_event(admin, org)
    link = admin.post(f"/api/events/{event['slug']}/links/", {"provider": "google"}, format="json").json()
    fake.failing.add(("DELETE", "calendars/primary/events/g-1"))
    response = admin.delete(f"/api/events/{event['slug']}/links/{link['id']}/")
    assert response.status_code == 400
    assert response.json() == ["Could not remove the Google Calendar event (500): {'error': 'backend error'}"]
    assert EventLink.objects.filter(id=link["id"]).exists()


def test_no_calendar_invite_for_an_event_taken_down(admin, bob, org):
    event = create_event(admin, org)
    ticket = bob.post(f"/api/events/{event['slug']}/register/").json()["my_registration"]["ticket_code"]
    assert bob.get(f"/api/tickets/{ticket}/calendar.ics").status_code == 200
    Event.objects.filter(slug=event["slug"]).update(status=Event.Status.DRAFT)
    assert bob.get(f"/api/tickets/{ticket}/calendar.ics").status_code == 404


def test_an_invitation_without_an_attendee(admin, org):
    event = Event.objects.get(slug=create_event(admin, org)["slug"])
    invite = calendar.build(event, with_link=True, method="REQUEST").decode()
    assert "METHOD:REQUEST" in invite and "ORGANIZER" in invite and "ATTENDEE" not in invite


# --- the providers' APIs, one by one ---------------------------------------------------------


@pytest.fixture
def answer(monkeypatch):
    """Make every provider call get `answer.response`, and record the requests."""

    class Answer:
        response = httpx.Response(200, json={})
        requests = []

    def handle(request):
        Answer.requests.append(request)
        return Answer.response

    monkeypatch.setattr(providers, "http", lambda: httpx.Client(transport=httpx.MockTransport(handle)))
    return Answer


@pytest.fixture
def event(admin, org):
    return Event.objects.get(slug=create_event(admin, org)["slug"])


def test_real_clients_time_out():
    with providers.http() as client:
        assert client.timeout.read == 20


def test_provider_errors_quote_the_provider():
    with pytest.raises(providers.ProviderError, match=r"Could not sync \(400\): \{'error': 'bad'\}"):
        providers._check(httpx.Response(400, json={"error": "bad"}), "sync")
    with pytest.raises(providers.ProviderError, match=r"Could not sync \(502\): <html>Bad gateway"):
        providers._check(httpx.Response(502, text="<html>Bad gateway</html>"), "sync")
    assert providers._check(httpx.Response(204), "sync") == {}


def test_a_provider_must_say_how_it_handles_events():
    base = providers.Provider()
    assert base.account_email({"id_token": id_token("x@example.com")}) == ""
    with pytest.raises(NotImplementedError):
        base.create("token", None, meeting=False)
    with pytest.raises(NotImplementedError):
        base.update("token", "id", None)
    with pytest.raises(NotImplementedError):
        base.delete("token", "id")


def test_unreadable_id_tokens_have_no_claims():
    assert providers._jwt_claims("") == {}
    assert providers._jwt_claims("header.@@@@.signature") == {}


def test_google_calendar_copy_without_a_meeting(answer, event):
    answer.response = httpx.Response(200, json={"id": "g-2"})
    assert providers.PROVIDERS["google"].create("tok", event, meeting=False) == ("g-2", "")
    sent = json.loads(answer.requests[-1].content)
    assert "conferenceData" not in sent and sent["summary"] == "Intro to APIs"
    assert answer.requests[-1].headers["authorization"] == "Bearer tok"


def test_google_meet_link_from_the_entry_points(answer, event):
    answer.response = httpx.Response(200, json={"id": "g-3", "conferenceData": {"entryPoints": [
        {"entryPointType": "phone", "uri": "tel:+1-555"},
        {"entryPointType": "video", "uri": "https://meet.google.com/xyz"},
    ]}})
    assert providers.PROVIDERS["google"].create("tok", event, meeting=True) == ("g-3", "https://meet.google.com/xyz")


@pytest.mark.parametrize("gone", [404, 410])
def test_google_copy_already_gone(answer, gone):
    answer.response = httpx.Response(gone)
    providers.PROVIDERS["google"].delete("tok", "g-1")
    assert answer.requests[-1].method == "DELETE"


def test_outlook_copy_already_gone(answer):
    answer.response = httpx.Response(404)
    providers.PROVIDERS["microsoft"].delete("tok", "ms-1")
    assert str(answer.requests[-1].url) == "https://graph.microsoft.com/v1.0/me/events/ms-1"


def test_zoom_meeting_updates_and_removal(answer, event):
    answer.response = httpx.Response(204)
    zoom = providers.PROVIDERS["zoom"]
    zoom.update("tok", "987", event)
    request = answer.requests[-1]
    assert (request.method, str(request.url)) == ("PATCH", "https://api.zoom.us/v2/meetings/987")
    assert json.loads(request.content)["topic"] == "Intro to APIs"

    answer.response = httpx.Response(404)
    zoom.delete("tok", "987")
    answer.response = httpx.Response(500, json={"message": "down"})
    with pytest.raises(providers.ProviderError, match="Could not remove the Zoom meeting"):
        zoom.delete("tok", "987")


# --- slow work after the request ---------------------------------------------------------------


@pytest.fixture
def threads(monkeypatch, settings):
    """Run background work on real threads, and keep them to wait for."""
    settings.BACKGROUND_TASKS = "thread"
    started = []

    class Recorded(threading.Thread):
        def start(self):
            started.append(self)
            super().start()

    monkeypatch.setattr(background.threading, "Thread", Recorded)
    return started


def test_background_work_waits_for_the_commit_then_runs_on_a_thread(threads, django_capture_on_commit_callbacks):
    ran_on = []
    with django_capture_on_commit_callbacks(execute=True):
        background.run_later(lambda: ran_on.append(threading.current_thread()))
        assert not threads
    threads[0].join(5)
    assert ran_on == [threads[0]]


def test_failed_background_work_is_logged(threads, django_capture_on_commit_callbacks, caplog):
    def sync_calendar():
        raise RuntimeError("Google is down")

    with django_capture_on_commit_callbacks(execute=True):
        background.run_later(sync_calendar)
    threads[0].join(5)
    assert "Background task sync_calendar failed" in caplog.text
    assert "Google is down" in caplog.text
