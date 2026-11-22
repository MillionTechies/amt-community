import io
import threading
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from amt_auth.exceptions import AdminAPIError
from django.core import mail
from django.core.management import call_command
from django.utils import timezone

from apps.accounts.models import Profile
from apps.events.models import Event, Registration
from apps.notifications import emails, sender, ticket
from apps.notifications.management.commands import run_worker
from apps.notifications.models import OutboundEmail
from tests.conftest import in_days, sign_in
from tests.test_events import create_event


def register(client, event):
    return client.post(f"/api/events/{event['slug']}/register/")


def invite(message):
    return next((a for a in message.attachments if isinstance(a, tuple) and a[0] == "invite.ics"), None)


def test_registering_sends_a_confirmation_with_ticket_and_invite(admin, bob, org):
    event = create_event(admin, org, title="Intro to APIs", delivery_mode="hybrid")
    register(bob, event)
    assert len(mail.outbox) == 1
    message = mail.outbox[0]
    assert message.to == ["bob@example.com"]
    assert message.subject == "You're registered: Intro to APIs"
    html = message.alternatives[0][0]
    registration = Registration.objects.get()
    assert "Congrats, Bob!" in message.body and f"Order #{registration.order_number}" in message.body
    assert "cid:ticket" in html and "meet.example.com/apis" in html
    assert "Show this at check-in" in html and "ADMIT ONE" in html and '"@type": "EventReservation"' in html
    assert f"/api/tickets/{registration.ticket_code}/ticket.pdf" in html
    assert "calendar.google.com" in html and "maps/search" in html and "linkedin.com" in html
    name, content, kind = invite(message)
    assert kind.startswith("text/calendar; method=REQUEST") and "ATTENDEE" in content
    assert any(getattr(a, "get_content_type", lambda: "")() == "image/png" for a in message.attachments)
    pdf = next(a for a in message.attachments if isinstance(a, tuple) and a[0].endswith(".pdf"))
    assert pdf[0] == f"{registration.order_number}.pdf" and pdf[1].startswith(b"%PDF")
    assert OutboundEmail.objects.get().status == OutboundEmail.Status.SENT


def test_waiting_list_and_promotion(admin, bob, carol, org):
    event = create_event(admin, org, capacity=1)
    register(bob, event)
    register(carol, event)
    assert mail.outbox[1].subject.startswith("You're on the waiting list")
    assert invite(mail.outbox[1]) is None  # no invite until there is a place

    bob.delete(f"/api/events/{event['slug']}/register/")
    promoted = mail.outbox[2]
    assert promoted.to == ["carol@example.com"] and promoted.subject.startswith("A place opened up")
    assert invite(promoted) is not None


def test_announcements_email_registered_people_when_asked(admin, bob, carol, org):
    event = create_event(admin, org)
    register(bob, event)
    mail.outbox.clear()
    url = f"/api/events/{event['slug']}/announcements/"
    quiet = admin.post(url, {"title": "Room change", "body": "<p>Lab 4</p>"}, format="json")
    assert quiet.status_code == 201 and mail.outbox == []

    loud = admin.post(url, {"title": "Room change", "body": "<p>Now <b>Lab 4</b></p>", "notify": True}, format="json")
    assert loud.json()["emailed_to"] == 1
    assert [m.to for m in mail.outbox] == [["bob@example.com"]]
    assert "Now Lab 4" in mail.outbox[0].body and "<b>Lab 4</b>" in mail.outbox[0].alternatives[0][0]


def test_changes_to_time_or_place_are_emailed(admin, bob, org):
    event = create_event(admin, org)
    register(bob, event)
    mail.outbox.clear()
    url = f"/api/events/{event['slug']}/"
    admin.patch(url, {"summary": "Just wording"}, format="json")
    assert mail.outbox == []  # nothing that changes someone's plans

    admin.patch(url, {"venue": "Lab 4"}, format="json")
    assert len(mail.outbox) == 1
    assert mail.outbox[0].subject == "Updated: Intro to APIs"
    assert "Lab 3" in mail.outbox[0].body and "Lab 4" in mail.outbox[0].body


def test_cancelling_tells_everyone_and_removes_the_invite(admin, bob, carol, org):
    event = create_event(admin, org, capacity=1)
    register(bob, event)
    register(carol, event)
    mail.outbox.clear()
    admin.post(f"/api/events/{event['slug']}/transition/", {"status": "cancelled"}, format="json")
    assert sorted(m.to[0] for m in mail.outbox) == ["bob@example.com", "carol@example.com"]
    to_bob = next(m for m in mail.outbox if m.to == ["bob@example.com"])
    name, content, kind = invite(to_bob)
    assert kind.startswith("text/calendar; method=CANCEL") and "STATUS:CANCELLED" in content


def test_reminders_go_out_once(admin, bob, org):
    event = create_event(admin, org, starts_at=in_days(3), ends_at=in_days(3.1))
    register(bob, event)
    mail.outbox.clear()
    starts = Event.objects.get(slug=event["slug"]).starts_at

    assert emails.queue_reminders(now=starts - timedelta(hours=30)) == 0
    assert emails.queue_reminders(now=starts - timedelta(hours=20)) == 1
    assert emails.queue_reminders(now=starts - timedelta(hours=19)) == 0  # already sent
    assert emails.queue_reminders(now=starts - timedelta(minutes=40)) == 1
    assert [m.subject.split(":")[0] for m in mail.outbox] == ["Tomorrow", "Starting soon"]


def test_failed_sends_are_retried(admin, bob, org, settings):
    settings.EMAIL_DELIVERY = "worker"
    event = create_event(admin, org)
    register(bob, event)
    queued = OutboundEmail.objects.get()
    assert queued.status == OutboundEmail.Status.QUEUED and mail.outbox == []

    settings.EMAIL_BACKEND = "tests.test_notifications.BrokenBackend"
    assert sender.send_queued() == 0
    queued.refresh_from_db()
    assert queued.status == OutboundEmail.Status.QUEUED and queued.attempts == 1
    assert "connection refused" in queued.last_error

    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    assert sender.send_queued() == 1
    assert len(mail.outbox) == 1


class BrokenBackend:
    def __init__(self, *args, **kwargs):
        pass

    def send_messages(self, messages):
        raise ConnectionRefusedError("connection refused")


def test_tickets_download_as_pdf(admin, bob, org):
    event = create_event(admin, org)
    register(bob, event)
    registration = Registration.objects.get()
    response = bob.get(f"/api/tickets/{registration.ticket_code}/ticket.pdf")
    assert response.status_code == 200 and response["Content-Type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
    assert registration.order_number.startswith("AMT-") and len(registration.order_number) == 12

    bob.delete(f"/api/events/{event['slug']}/register/")
    assert bob.get(f"/api/tickets/{registration.ticket_code}/ticket.pdf").status_code == 404


def test_online_events_have_no_door_ticket(admin, bob, org):
    event = create_event(admin, org, delivery_mode="online", venue="")
    register(bob, event)
    message = mail.outbox[0]
    assert "cid:ticket" not in message.alternatives[0][0]
    assert not any(isinstance(a, tuple) and a[0].endswith(".pdf") for a in message.attachments)
    assert "Join online" in message.alternatives[0][0] or "Join on" in message.alternatives[0][0]


def test_events_over_several_days_show_both_dates(admin, org):
    event = Event.objects.get(slug=create_event(admin, org)["slug"])
    event.starts_at = datetime(2026, 11, 30, 6, 0, tzinfo=UTC)
    event.ends_at = datetime(2026, 12, 1, 14, 30, tzinfo=UTC)
    assert emails.when(event) == "Mon 30 Nov 2026, 09:00 to Tue 1 Dec 2026, 17:30 (EAT)"


def test_members_without_an_email_address_get_no_email():
    profile = Profile.objects.create(sub="sub-noemail", email="", full_name="No Email")
    emails.welcome(profile)
    assert not OutboundEmail.objects.exists() and mail.outbox == []


def test_a_cancelled_registration_is_not_emailed_as_new(admin, bob, org):
    event = create_event(admin, org)
    register(bob, event)
    mail.outbox.clear()
    registration = Registration.objects.get()
    registration.status = Registration.Status.CANCELLED
    emails.registration_changed(registration)
    assert mail.outbox == [] and OutboundEmail.objects.count() == 1


def test_event_cards_without_a_live_registration(admin, bob, org):
    event = Event.objects.get(slug=create_event(admin, org)["slug"])
    anyone = emails._event_block(event)
    assert "order_number" not in anyone and "ticket_url" not in anyone and "cancel_url" not in anyone

    register(bob, {"slug": event.slug})
    registration = Registration.objects.get()
    registration.status = Registration.Status.CANCELLED
    cancelled = emails._event_block(event, registration)
    assert cancelled["order_number"] == registration.order_number
    assert "ticket_url" not in cancelled and "cancel_url" not in cancelled


def test_a_new_start_time_is_emailed(admin, bob, org):
    event = create_event(admin, org)
    register(bob, event)
    mail.outbox.clear()
    starts = datetime(2027, 1, 15, 7, 0, tzinfo=UTC)
    admin.patch(f"/api/events/{event['slug']}/", {"starts_at": starts.isoformat(), "ends_at": (starts + timedelta(hours=2)).isoformat()}, format="json")
    assert len(mail.outbox) == 1
    assert "Fri 15 Jan 2027, 10:00" in mail.outbox[0].body


def test_only_published_events_email_their_changes(admin, bob, org):
    event = create_event(admin, org)
    register(bob, event)
    mail.outbox.clear()
    admin.post(f"/api/events/{event['slug']}/transition/", {"status": "completed"}, format="json")
    completed = Event.objects.get(slug=event["slug"])
    before = emails.snapshot(completed)
    completed.venue = "Lab 9"
    assert emails.event_changed(completed, before) == 0
    assert mail.outbox == []


def test_emails_are_sent_on_a_thread_after_the_request_commits(settings, monkeypatch, django_capture_on_commit_callbacks):
    settings.EMAIL_DELIVERY = "thread"
    sent = []
    started = []

    class Recorded(threading.Thread):
        def start(self):
            started.append(self)
            super().start()

    monkeypatch.setattr(sender.threading, "Thread", Recorded)
    monkeypatch.setattr(sender, "send_queued", lambda ids: sent.append((ids, threading.current_thread())))
    with django_capture_on_commit_callbacks(execute=True):
        sender.deliver([1, 2])
        assert started == []
    started[0].join(5)
    assert sent == [([1, 2], started[0])]


def test_a_ticket_email_whose_registration_is_gone_goes_without_the_pdf(admin, bob, org, settings):
    settings.EMAIL_DELIVERY = "worker"
    register(bob, create_event(admin, org))
    Registration.objects.all().delete()
    assert sender.send_queued() == 1
    message = mail.outbox[0]
    assert not any(isinstance(a, tuple) and a[0].endswith(".pdf") for a in message.attachments)
    assert str(OutboundEmail.objects.get()) == "registered to bob@example.com"


def test_tickets_for_a_venue_not_yet_chosen(admin, org):
    event = Event.objects.get(slug=create_event(admin, org)["slug"])
    event.venue = ""
    assert ticket.where_line(event) == "Venue to be confirmed"
    event.delivery_mode = Event.Mode.ONLINE
    assert ticket.where_line(event) == "Online"


# --- the worker -------------------------------------------------------------------------------


class Stop(Exception):
    """Raised from the worker's sleep, to end its loop."""


@pytest.fixture
def worker(monkeypatch):
    """Run the worker loop once round: its sleep stops it. `worker.sync` stands in for Keycloak."""

    class Worker:
        sleeps = []
        syncs = 0
        sync_result = 2

    def sync():
        Worker.syncs += 1
        if isinstance(Worker.sync_result, Exception):
            raise Worker.sync_result
        return Worker.sync_result

    def sleep(seconds):
        Worker.sleeps.append(seconds)
        raise Stop

    monkeypatch.setattr(run_worker, "locked_sync_all", sync)
    monkeypatch.setattr(run_worker.time, "sleep", sleep)
    return Worker


def test_one_worker_pass_sends_queued_email_and_releases_stuck_ones(admin, bob, org, settings, worker):
    settings.EMAIL_DELIVERY = "worker"
    register(bob, create_event(admin, org))
    stuck = OutboundEmail.objects.get()
    OutboundEmail.objects.filter(pk=stuck.pk).update(
        status=OutboundEmail.Status.SENDING, claimed_at=timezone.now() - timedelta(minutes=11)
    )
    out = io.StringIO()
    call_command("run_worker", "--once", stdout=out)
    assert out.getvalue() == "Queued 0 reminders, sent 1 emails.\n"
    assert len(mail.outbox) == 1 and worker.syncs == 0 and worker.sleeps == []


def test_a_quiet_worker_pass_says_nothing(worker):
    out = io.StringIO()
    call_command("run_worker", "--once", stdout=out)
    assert out.getvalue() == ""


def test_the_worker_syncs_organizations_then_sleeps(worker):
    out = io.StringIO()
    with pytest.raises(Stop):
        call_command("run_worker", "--interval", "7", stdout=out)
    assert worker.syncs == 1 and worker.sleeps == [7] and out.getvalue() == ""


def test_the_worker_skips_a_sync_already_running(worker):
    worker.sync_result = None
    out = io.StringIO()
    with pytest.raises(Stop):
        call_command("run_worker", stdout=out)
    assert out.getvalue() == "Organization sync skipped: another sync is running.\n"


@pytest.mark.parametrize("error", [AdminAPIError(500, "boom"), httpx.ConnectError("down")])
def test_the_worker_keeps_going_when_keycloak_fails(worker, error, caplog):
    worker.sync_result = error
    with pytest.raises(Stop):
        call_command("run_worker", stdout=io.StringIO())
    assert worker.sleeps == [30]
    assert "Organization sync from Keycloak failed; will try again" in caplog.text


def test_the_worker_can_leave_syncing_to_sign_ins(worker):
    with pytest.raises(Stop):
        call_command("run_worker", "--sync-interval", "0", stdout=io.StringIO())
    assert worker.syncs == 0 and worker.sleeps == [30]


def test_the_worker_syncs_again_only_when_due(worker, monkeypatch):
    sleeps = iter([None, Stop()])

    def sleep(seconds):
        worker.sleeps.append(seconds)
        result = next(sleeps)
        if result is not None:
            raise result

    monkeypatch.setattr(run_worker.time, "sleep", sleep)
    with pytest.raises(Stop):
        call_command("run_worker", stdout=io.StringIO())
    assert worker.syncs == 1 and len(worker.sleeps) == 2
