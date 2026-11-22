"""Connected accounts, against fake Google, Microsoft and Zoom servers."""

import base64
import json
import threading
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from django.conf import settings
from django.core import mail
from django.urls import reverse
from django.utils import timezone
from model_bakery import baker

from apps.configuration.models import Setting, seal
from apps.events.models import Event, Registration
from apps.integrations import background, calendar, providers, service
from apps.integrations.models import Connection, EventLink
from tests.conftest import sign_in


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
    settings.GOOGLE_OAUTH_CLIENT_ID, settings.GOOGLE_OAUTH_CLIENT_SECRET = "google-client", "secret"
    settings.MICROSOFT_OAUTH_CLIENT_ID, settings.MICROSOFT_OAUTH_CLIENT_SECRET = "microsoft-client", "secret"
    settings.ZOOM_OAUTH_CLIENT_ID, settings.ZOOM_OAUTH_CLIENT_SECRET = "zoom-client", "secret"
    server = FakeProviders()
    monkeypatch.setattr(providers, "http", lambda: httpx.Client(transport=httpx.MockTransport(server)))
    return server


@pytest.fixture
def event(org):
    starts_at = timezone.now() + timedelta(days=7)
    return baker.make(
        Event, organization=org, title="Intro to APIs", status=Event.Status.PUBLISHED,
        delivery_mode=Event.Mode.IN_PERSON, venue="Lab 3", starts_at=starts_at, ends_at=starts_at + timedelta(hours=2),
    )


def connection(client, provider, **fields):
    return baker.make(
        Connection, profile=client.profile, provider=provider,
        **{"account_email": "alice@work.example", "access_token": "access-1", "refresh_token": "refresh-1", **fields},
    )


def start(client, provider_id, **data):
    return client.post(reverse("integration", kwargs={"provider_id": provider_id}), data, format="json")


def state_from(response):
    return parse_qs(urlparse(response.json()["authorize_url"]).query)["state"][0]


def callback(client, provider_id, **params):
    return client.get(reverse("integration-callback", kwargs={"provider_id": provider_id}), params)


def connect(client, provider_id):
    started = start(client, provider_id)
    query = parse_qs(urlparse(started.json()["authorize_url"]).query)
    assert query["redirect_uri"] == [settings.API_URL + reverse("integration-callback", kwargs={"provider_id": provider_id})]
    return callback(client, provider_id, code="the-code", state=query["state"][0])


def add_copy(client, event, provider, meeting=False):
    return client.post(reverse("event-links", kwargs={"slug": event.slug}), {"provider": provider, "meeting": meeting}, format="json")


def remove_copy(client, event, link_id):
    return client.delete(reverse("event-link", kwargs={"slug": event.slug, "link_id": link_id}))


# --- connecting an account ------------------------------------------------------------------


@pytest.mark.parametrize("provider, email, basic_auth", [
    ("google", "alice@work.example", False),
    ("microsoft", "alice@work.example", False),
    ("zoom", "alice@zoom.example", True),
])
def test_connecting_and_disconnecting_an_account(admin, fake, provider, email, basic_auth):
    back = connect(admin, provider)
    assert back.status_code == 302 and back["Location"].endswith(f"/manage/integrations?connected={provider}")
    stored = Connection.objects.get(provider=provider)
    assert stored.account_email == email
    assert stored.access_token == "access-1" and "access-1" not in stored.access_token_sealed
    # Zoom wants the client credentials as Basic auth; the others take them in the form.
    token_request = fake.last("POST", "token")[2]
    assert token_request.headers.get("authorization", "").startswith("Basic ") is basic_auth
    listed = {p["id"]: p for p in admin.get(reverse("integrations")).json()}
    assert listed[provider]["connected"] and listed[provider]["account_email"] == email

    assert admin.delete(reverse("integration", kwargs={"provider_id": provider})).status_code == 204
    assert not Connection.objects.exists()


def test_connecting_needs_a_known_service_that_is_set_up(admin, settings):
    settings.GOOGLE_OAUTH_CLIENT_ID = ""
    listed = {p["id"]: p for p in admin.get(reverse("integrations")).json()}
    assert listed["google"]["configured"] is False and listed["google"]["connected"] is False
    assert start(admin, "google").status_code == 400
    assert start(admin, "myspace").status_code == 404
    assert admin.delete(reverse("integration", kwargs={"provider_id": "myspace"})).status_code == 404


def test_the_callback_sends_the_browser_back_with_an_error_when_it_cannot_trust_the_answer(admin, fake):
    assert callback(admin, "google", error="access_denied")["Location"].endswith("/manage/integrations?error=google")
    assert callback(admin, "google", code="x", state="forged")["Location"].endswith("?error=google")
    google_state = state_from(start(admin, "google"))
    assert callback(admin, "zoom", code="the-code", state=google_state)["Location"].endswith("?error=zoom")
    assert not fake.calls

    fake.failing.add(("POST", "oauth2.googleapis.com/token"))
    assert connect(admin, "google")["Location"].endswith("?error=google")
    assert not Connection.objects.exists()


def test_reconnecting_keeps_what_the_provider_did_not_send_again(admin, fake):
    connect(admin, "google")
    fake.token_overrides = {"refresh_token": None, "id_token": None}
    connect(admin, "google")
    stored = Connection.objects.get()
    assert stored.access_token == "access-2"
    assert stored.refresh_token == "refresh-1"
    assert stored.account_email == "alice@work.example"
    assert str(stored) == "Alice on Google"


@pytest.mark.parametrize("answer, refresh_token, expires", [
    ({"refresh_token": "refresh-2"}, "refresh-2", True),
    ({"refresh_token": None, "expires_in": None}, "refresh-1", False),
])
def test_expired_tokens_are_refreshed(admin, fake, answer, refresh_token, expires):
    fake.token_overrides = answer
    expired = connection(admin, "google", access_token="stale", expires_at=timezone.now() - timedelta(minutes=1))
    assert service.token_for(expired) == "access-1"
    sent = parse_qs(fake.last("POST", "oauth2.googleapis.com/token")[2].content.decode())
    assert sent["grant_type"] == ["refresh_token"] and sent["refresh_token"] == ["refresh-1"]
    expired.refresh_from_db()
    assert expired.refresh_token == refresh_token
    assert (expired.expires_at is not None) is expires


def test_organisation_apps_are_only_for_those_who_run_its_events(admin, bob, org, other_org, fake):
    baker.make(Setting, organization=other_org, key="zoom.client_id", value="uon")
    baker.make(Setting, organization=other_org, key="zoom.client_secret", value=seal("uon-secret"))
    root = sign_in("root", platform_admin=True)
    uon_admin = sign_in("root2", platform_admin=True, admin_of=[other_org])

    def zoom_apps(client):
        return {(i["app"], i["app_name"]) for i in client.get(reverse("integrations")).json() if i["id"] == "zoom"}

    assert zoom_apps(root) == {(None, "A Million Techies")}
    assert zoom_apps(uon_admin) == {(None, "A Million Techies"), (other_org.id, "UON")}
    assert zoom_apps(admin) == {(None, "A Million Techies")}
    assert start(bob, "zoom", app=org.id).status_code == 403
    assert not fake.calls


# --- an event's copies in calendars and meeting tools ---------------------------------------------


@pytest.mark.parametrize("provider, join_url, meeting_name", [
    ("google", "https://meet.google.com/abc-defg-hij", "Google Meet"),
    ("microsoft", "https://teams.microsoft.com/l/meetup-join/xyz", "Microsoft Teams"),
    ("zoom", "https://us02web.zoom.us/j/987", "Zoom"),
])
def test_a_new_meeting_becomes_the_events_join_link(admin, bob, event, fake, provider, join_url, meeting_name):
    connection(admin, provider)
    baker.make(Registration, event=event, profile=bob.profile)

    made = add_copy(admin, event, provider, meeting=True)
    assert made.status_code == 201 and made.json()["join_url"] == join_url
    detail = admin.get(reverse("event-detail", kwargs={"slug": event.slug})).json()
    assert detail["online_url"] == join_url
    assert detail["delivery_mode"] == "hybrid" and detail["meeting_provider"]["name"] == meeting_name
    assert mail.outbox[-1].subject == "Updated: Intro to APIs"  # attendees get the link


@pytest.mark.parametrize("provider, meeting, item_url, title_field", [
    ("google", False, "https://www.googleapis.com/calendar/v3/calendars/primary/events/g-1", "summary"),
    ("microsoft", False, "https://graph.microsoft.com/v1.0/me/events/ms-1", "subject"),
    ("zoom", True, "https://api.zoom.us/v2/meetings/987", "topic"),
])
def test_copies_follow_the_events_changes_and_cancellation(admin, event, fake, provider, meeting, item_url, title_field):
    connection(admin, provider)
    detail_url = reverse("event-detail", kwargs={"slug": event.slug})
    admin.patch(detail_url, {"summary": "Before any copy"}, format="json")
    assert not fake.calls

    add_copy(admin, event, provider, meeting=meeting)
    admin.patch(detail_url, {"title": "Renamed"}, format="json")
    assert json.loads(fake.last("PATCH", item_url)[2].content)[title_field] == "Renamed"

    admin.post(reverse("event-transition", kwargs={"slug": event.slug}), {"status": "cancelled"}, format="json")
    assert fake.last("DELETE", item_url)
    assert not EventLink.objects.exists()


def test_a_calendar_copy_is_replaced_when_added_again_and_removed_on_request(admin, event, fake):
    connection(admin, "microsoft")
    first = add_copy(admin, event, "microsoft").json()
    assert first["is_meeting"] is False and first["join_url"] == ""
    sent = json.loads(fake.last("POST", "graph.microsoft.com")[2].content)
    assert "isOnlineMeeting" not in sent and sent["subject"] == "Intro to APIs"

    second = add_copy(admin, event, "microsoft").json()
    assert fake.last("DELETE", "graph.microsoft.com/v1.0/me/events/ms-1")
    assert list(EventLink.objects.values_list("id", flat=True)) == [second["id"]] != [first["id"]]

    fake.calls.clear()
    assert remove_copy(admin, event, second["id"]).status_code == 204
    assert fake.last("DELETE", "graph.microsoft.com/v1.0/me/events/ms-1")
    assert not EventLink.objects.exists()


def test_organisers_see_whose_copies_they_are_and_only_the_one_who_added_it_removes_it(admin, bob, org, event, fake):
    co_organiser = sign_in("dora", admin_of=[org])
    assert add_copy(bob, event, "google").status_code == 403
    no_account = add_copy(co_organiser, event, "google")
    assert no_account.status_code == 400 and no_account.json() == ["Connect your Google account first."]

    connection(admin, "microsoft")
    add_copy(admin, event, "microsoft")
    url = reverse("event-links", kwargs={"slug": event.slug})
    mine = admin.get(url).json()
    assert [(l["provider"], l["account_email"], l["mine"]) for l in mine] == [("microsoft", "alice@work.example", True)]
    assert [l["mine"] for l in co_organiser.get(url).json()] == [False]
    assert remove_copy(co_organiser, event, mine[0]["id"]).status_code == 403
    assert EventLink.objects.exists()


@pytest.mark.parametrize("provider, meeting, meeting_name, status, message", [
    ("zoom", False, "Zoom", Event.Status.PUBLISHED, "Zoom has no calendar to add events to."),
    ("zoom", True, "", Event.Status.PUBLISHED, "Zoom cannot make meetings."),
    ("google", False, "Google Meet", Event.Status.CANCELLED, "This event is cancelled."),
])
def test_copies_a_service_cannot_make_are_refused(admin, event, fake, monkeypatch, provider, meeting, meeting_name, status, message):
    monkeypatch.setattr(providers.PROVIDERS[provider], "meeting_name", meeting_name)
    Event.objects.filter(pk=event.pk).update(status=status)
    connection(admin, provider)
    response = add_copy(admin, event, provider, meeting=meeting)
    assert response.status_code == 400 and response.json() == [message]
    assert not fake.calls and not EventLink.objects.exists()


@pytest.mark.parametrize("failing, fields, message", [
    ({("POST", "googleapis.com/calendar")}, {}, "Could not create the Google Calendar event (500): {'error': 'backend error'}"),
    (set(), {"refresh_token": "", "expires_at": timezone.now()}, "Your Google connection has expired. Connect it again."),
])
def test_a_provider_failure_is_shown_to_the_organiser_and_nothing_is_kept(admin, event, fake, failing, fields, message):
    fake.failing = failing
    connection(admin, "google", **fields)
    response = add_copy(admin, event, "google")
    assert response.status_code == 400 and response.json() == [message]
    assert not EventLink.objects.exists()


def test_removing_a_meeting_removes_the_join_link_unless_the_service_fails(admin, event, fake):
    Event.objects.filter(pk=event.pk).update(delivery_mode=Event.Mode.ONLINE, venue="")
    connection(admin, "zoom")
    link = add_copy(admin, event, "zoom", meeting=True).json()
    detail_url = reverse("event-detail", kwargs={"slug": event.slug})

    fake.failing.add(("DELETE", "api.zoom.us/v2/meetings/987"))
    failed = remove_copy(admin, event, link["id"])
    assert failed.status_code == 400
    assert failed.json() == ["Could not remove the Zoom meeting (500): {'error': 'backend error'}"]
    assert admin.get(detail_url).json()["online_url"] == "https://us02web.zoom.us/j/987"

    fake.failing.clear()
    assert remove_copy(admin, event, link["id"]).status_code == 204
    assert fake.last("DELETE", "api.zoom.us/v2/meetings/987")
    assert admin.get(detail_url).json()["online_url"] == ""
    assert not EventLink.objects.exists()


# --- calendar invites and tickets ------------------------------------------------------------------


def test_only_a_registered_member_gets_the_meeting_link_and_only_while_the_event_is_public(anonymous, bob, event):
    Event.objects.filter(pk=event.pk).update(
        delivery_mode=Event.Mode.ONLINE, venue="", online_url="https://us02web.zoom.us/j/987", summary="", description="Bring a laptop.",
    )
    registration = baker.make(Registration, event=event, profile=bob.profile)
    public_url = reverse("event-calendar", kwargs={"slug": event.slug})
    ticket_url = reverse("ticket-calendar", kwargs={"ticket_code": registration.ticket_code})

    public = anonymous.get(public_url).content.decode()
    assert "LOCATION:Online (Zoom)" in public and "Bring a laptop." in public and "zoom.us/j/987" not in public
    assert "LOCATION:https://us02web.zoom.us/j/987" in anonymous.get(ticket_url).content.decode()
    ticket = anonymous.get(reverse("ticket-pdf", kwargs={"ticket_code": registration.ticket_code}))
    assert ticket.status_code == 200 and ticket["Content-Type"] == "application/pdf"

    Event.objects.filter(pk=event.pk).update(status=Event.Status.DRAFT)
    assert anonymous.get(public_url).status_code == 404
    assert anonymous.get(ticket_url).status_code == 404


def test_an_invitation_without_an_attendee_joins_an_unknown_service_online(event):
    event.online_url = "https://meet.example.com/apis"
    invite = calendar.build(event, with_link=True, method="REQUEST").decode()
    assert "METHOD:REQUEST" in invite and "ORGANIZER" in invite and "ATTENDEE" not in invite
    assert "Join online: https://meet.example.com/apis" in invite


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
    assert providers._jwt_claims("header.@@@@.signature") == {}
    with pytest.raises(NotImplementedError):
        base.create("token", None, meeting=False)
    with pytest.raises(NotImplementedError):
        base.update("token", "id", None)
    with pytest.raises(NotImplementedError):
        base.delete("token", "id")


def test_google_meet_link_from_the_entry_points(answer, event):
    answer.response = httpx.Response(200, json={"id": "g-3", "conferenceData": {"entryPoints": [
        {"entryPointType": "phone", "uri": "tel:+1-555"},
        {"entryPointType": "video", "uri": "https://meet.google.com/xyz"},
    ]}})
    assert providers.PROVIDERS["google"].create("tok", event, meeting=True) == ("g-3", "https://meet.google.com/xyz")
    assert answer.requests[-1].headers["authorization"] == "Bearer tok"


@pytest.mark.parametrize("provider, gone, url", [
    ("google", 404, "https://www.googleapis.com/calendar/v3/calendars/primary/events/item-1"),
    ("google", 410, "https://www.googleapis.com/calendar/v3/calendars/primary/events/item-1"),
    ("microsoft", 404, "https://graph.microsoft.com/v1.0/me/events/item-1"),
    ("zoom", 404, "https://api.zoom.us/v2/meetings/item-1"),
])
def test_a_copy_already_gone_counts_as_removed(answer, provider, gone, url):
    answer.response = httpx.Response(gone)
    providers.PROVIDERS[provider].delete("tok", "item-1")
    assert (answer.requests[-1].method, str(answer.requests[-1].url)) == ("DELETE", url)


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


def test_background_work_waits_for_the_commit_runs_on_a_thread_and_logs_failures(threads, django_capture_on_commit_callbacks, caplog):
    ran_on = []

    def sync_calendar():
        raise RuntimeError("Google is down")

    with django_capture_on_commit_callbacks(execute=True):
        background.run_later(lambda: ran_on.append(threading.current_thread()))
        background.run_later(sync_calendar)
        assert not threads
    threads[0].join(5)
    threads[1].join(5)
    assert ran_on == [threads[0]]
    assert "Background task sync_calendar failed" in caplog.text and "Google is down" in caplog.text
