import io
import threading
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from amt_auth.exceptions import AdminAPIError
from django.core import mail
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone
from model_bakery import baker

from apps.accounts.models import Profile
from apps.events.models import Event, Registration
from apps.notifications import emails, sender, ticket
from apps.notifications.management.commands import run_worker
from apps.notifications.models import OutboundEmail


@pytest.fixture
def event(org):
    starts = timezone.now() + timedelta(days=7)
    return baker.make(
        Event, organization=org, title="Intro to APIs", status=Event.Status.PUBLISHED,
        delivery_mode=Event.Mode.HYBRID, venue="Lab 3", online_url="https://meet.example.com/apis",
        starts_at=starts, ends_at=starts + timedelta(hours=2),
    )


def register(client, event):
    return client.post(reverse("event-register", kwargs={"slug": event.slug}))


def attachment(message, ending):
    """The attachment whose file name ends with `ending`, or None."""
    return next((a for a in message.attachments if isinstance(a, tuple) and a[0].endswith(ending)), None)


def test_registering_sends_a_confirmation_with_ticket_and_invite(bob, event):
    register(bob, event)
    [message] = mail.outbox
    registration = Registration.objects.get()
    html = message.alternatives[0][0]
    assert message.to == ["bob@example.com"]
    assert message.subject == "You're registered: Intro to APIs"
    assert "Congrats, Bob!" in message.body
    assert f"Order #{registration.order_number}" in message.body
    assert "cid:ticket" in html
    assert "meet.example.com/apis" in html
    assert "ADMIT ONE" in html
    assert '"@type": "EventReservation"' in html
    assert reverse("ticket-pdf", kwargs={"ticket_code": registration.ticket_code}) in html
    assert "calendar.google.com" in html
    assert "maps/search" in html
    assert "linkedin.com" in html
    name, content, kind = attachment(message, "invite.ics")
    assert kind.startswith("text/calendar; method=REQUEST")
    assert "ATTENDEE" in content
    name, pdf, kind = attachment(message, ".pdf")
    assert name == f"{registration.order_number}.pdf"
    assert pdf.startswith(b"%PDF")
    assert OutboundEmail.objects.get().status == OutboundEmail.Status.SENT


def test_the_waiting_list_gets_no_invite_until_a_place_opens(bob, carol, event):
    Event.objects.filter(pk=event.pk).update(capacity=1)
    register(bob, event)
    register(carol, event)
    waitlisted = mail.outbox[1]
    assert waitlisted.subject == "You're on the waiting list: Intro to APIs"
    assert attachment(waitlisted, "invite.ics") is None

    bob.delete(reverse("event-register", kwargs={"slug": event.slug}))
    promoted = mail.outbox[2]
    assert promoted.to == ["carol@example.com"]
    assert promoted.subject == "A place opened up: you're registered for Intro to APIs"
    assert attachment(promoted, "invite.ics") is not None


def test_online_events_have_no_door_ticket(bob, org):
    online = baker.make(
        Event, organization=org, status=Event.Status.PUBLISHED, delivery_mode=Event.Mode.ONLINE, online_url="https://meet.example.com/apis",
        starts_at=timezone.now() + timedelta(days=1), ends_at=timezone.now() + timedelta(days=1, hours=1),
    )
    register(bob, online)
    [message] = mail.outbox
    assert "cid:ticket" not in message.alternatives[0][0]
    assert "Join online" in message.alternatives[0][0]
    assert attachment(message, ".pdf") is None


def test_announcements_email_registered_people_when_asked(admin, bob, event):
    baker.make(Registration, event=event, profile=bob.profile)
    announcements = reverse("event-announcements", kwargs={"event_slug": event.slug})
    quiet = admin.post(announcements, {"title": "Room change", "body": "<p>Lab 4</p>"}, format="json")
    assert quiet.status_code == 201
    assert mail.outbox == []

    loud = admin.post(announcements, {"title": "Room change", "body": "<p>Now <b>Lab 4</b></p>", "notify": True}, format="json")
    assert loud.json()["emailed_to"] == 1
    [message] = mail.outbox
    assert message.to == ["bob@example.com"]
    assert "Now Lab 4" in message.body
    assert "<b>Lab 4</b>" in message.alternatives[0][0]


@pytest.mark.parametrize(
    "changes, line",
    [
        ({"summary": "Just wording"}, None),  # nothing that changes someone's plans
        ({"venue": "Lab 4"}, "Venue: Lab 3 -> Lab 4"),
        ({"starts_at": "2027-01-15T07:00:00Z", "ends_at": "2027-01-15T09:00:00Z"}, "-> Fri 15 Jan 2027, 10:00"),
        ({"delivery_mode": "online"}, "Format: Hybrid -> Online"),
        ({"online_url": "https://zoom.us/j/1"}, "Meeting link: New Zoom link"),
    ],
)
def test_changes_to_time_or_place_are_emailed(admin, bob, event, changes, line):
    baker.make(Registration, event=event, profile=bob.profile)
    admin.patch(reverse("event-detail", kwargs={"slug": event.slug}), changes, format="json")
    assert [m.subject for m in mail.outbox] == (["Updated: Intro to APIs"] if line else [])
    assert line is None or line in mail.outbox[0].body


def test_cancelling_tells_everyone_and_removes_the_invite(admin, bob, carol, event):
    baker.make(Registration, event=event, profile=bob.profile)
    baker.make(Registration, event=event, profile=carol.profile, status=Registration.Status.WAITLISTED)
    admin.post(reverse("event-transition", kwargs={"slug": event.slug}), {"status": "cancelled"}, format="json")
    to_bob, to_carol = sorted(mail.outbox, key=lambda m: m.to)
    name, content, kind = attachment(to_bob, "invite.ics")
    assert kind.startswith("text/calendar; method=CANCEL")
    assert "STATUS:CANCELLED" in content
    assert to_carol.subject == "Cancelled: Intro to APIs"
    assert attachment(to_carol, "invite.ics") is None  # it was never in her calendar


def test_reminders_go_out_once(bob, event):
    baker.make(Registration, event=event, profile=bob.profile)
    assert emails.queue_reminders(now=event.starts_at - timedelta(hours=30)) == 0
    assert emails.queue_reminders(now=event.starts_at - timedelta(hours=20)) == 1
    assert emails.queue_reminders(now=event.starts_at - timedelta(hours=19)) == 0  # already sent
    assert emails.queue_reminders(now=event.starts_at - timedelta(minutes=40)) == 1
    assert [m.subject for m in mail.outbox] == ["Tomorrow: Intro to APIs", "Starting soon: Intro to APIs"]


def test_nothing_is_emailed_to_people_it_does_not_concern(bob, event):
    emails.welcome(baker.make(Profile, email=""))
    emails.registration_changed(baker.make(Registration, event=event, profile=bob.profile, status=Registration.Status.CANCELLED))
    Event.objects.filter(pk=event.pk).update(status=Event.Status.COMPLETED)
    event.refresh_from_db()
    before = emails.snapshot(event)
    event.venue = "Lab 9"
    assert emails.event_changed(event, before) == 0
    assert not OutboundEmail.objects.exists()
    assert mail.outbox == []


def test_event_details_read_well_and_ticket_links_go_only_to_people_going(bob, event):
    anyone = emails._event_block(event)
    assert "order_number" not in anyone
    assert "ticket_url" not in anyone
    assert "cancel_url" not in anyone

    cancelled = baker.make(Registration, event=event, profile=bob.profile, status=Registration.Status.CANCELLED)
    card = emails._event_block(event, cancelled)
    assert card["order_number"] == cancelled.order_number
    assert "ticket_url" not in card
    assert "cancel_url" not in card

    event.starts_at = datetime(2026, 11, 30, 6, 0, tzinfo=UTC)
    event.ends_at = datetime(2026, 12, 1, 14, 30, tzinfo=UTC)
    assert emails.when(event) == "Mon 30 Nov 2026, 09:00 to Tue 1 Dec 2026, 17:30 (EAT)"
    event.delivery_mode = Event.Mode.IN_PERSON
    event.venue = ""
    assert emails.where(event) == "Venue to be confirmed"
    assert ticket.where_line(event) == "Venue to be confirmed"
    event.delivery_mode = Event.Mode.ONLINE
    assert ticket.where_line(event) == "Online"


def test_tickets_download_as_pdf_while_the_registration_stands(bob, event):
    registration = baker.make(Registration, event=event, profile=bob.profile)
    url = reverse("ticket-pdf", kwargs={"ticket_code": registration.ticket_code})
    response = bob.get(url)
    assert response.status_code == 200
    assert response["Content-Type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
    assert registration.order_number.startswith("AMT-")
    assert len(registration.order_number) == 12

    Registration.objects.update(status=Registration.Status.CANCELLED)
    assert bob.get(url).status_code == 404


# --- sending ---------------------------------------------------------------------------------


class BrokenBackend:
    def __init__(self, *args, **kwargs):
        pass

    def send_messages(self, messages):
        raise ConnectionRefusedError("connection refused")


def test_failed_sends_are_retried(bob, event, settings):
    settings.EMAIL_DELIVERY = "worker"
    register(bob, event)
    queued = OutboundEmail.objects.get()
    assert queued.status == OutboundEmail.Status.QUEUED
    assert mail.outbox == []

    settings.EMAIL_BACKEND = "tests.test_notifications.BrokenBackend"
    assert sender.send_queued() == 0
    queued.refresh_from_db()
    assert (queued.status, queued.attempts, queued.last_error) == (OutboundEmail.Status.QUEUED, 1, "connection refused")

    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    assert sender.send_queued() == 1
    assert len(mail.outbox) == 1


def test_a_ticket_email_whose_registration_is_gone_goes_without_the_pdf():
    email = baker.make(OutboundEmail, kind="registered", to="bob@example.com", ticket_code=str(uuid.uuid4()))
    assert sender.send_queued() == 1
    assert attachment(mail.outbox[0], ".pdf") is None
    assert str(email) == "registered to bob@example.com"


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


# --- the worker -------------------------------------------------------------------------------


class Stop(Exception):
    """Raised from the worker's sleep, to end its loop."""


@pytest.fixture
def worker(monkeypatch):
    """The worker, whose first sleep stops it. `worker.sync_result` stands in for Keycloak."""

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


def test_one_worker_pass_sends_queued_email_and_releases_stuck_ones(worker):
    quiet = io.StringIO()
    call_command("run_worker", "--once", stdout=quiet)
    assert quiet.getvalue() == ""

    baker.make(OutboundEmail, status=OutboundEmail.Status.SENDING, claimed_at=timezone.now() - timedelta(minutes=11))
    out = io.StringIO()
    call_command("run_worker", "--once", stdout=out)
    assert out.getvalue() == "Queued 0 reminders, sent 1 emails.\n"
    assert len(mail.outbox) == 1
    assert (worker.syncs, worker.sleeps) == (0, [])


@pytest.mark.parametrize(
    "args, sync_result, syncs, sleeps, output, log",
    [
        (["--interval", "7"], 2, 1, [7], "", ""),
        ([], None, 1, [30], "Organization sync skipped: another sync is running.\n", ""),
        ([], AdminAPIError(500, "boom"), 1, [30], "", "Organization sync from Keycloak failed; will try again"),
        (["--sync-interval", "0"], 2, 0, [30], "", ""),  # leave syncing to sign-ins
    ],
)
def test_the_worker_syncs_organizations_then_sleeps(worker, caplog, args, sync_result, syncs, sleeps, output, log):
    worker.sync_result = sync_result
    out = io.StringIO()
    with pytest.raises(Stop):
        call_command("run_worker", *args, stdout=out)
    assert (worker.syncs, worker.sleeps, out.getvalue()) == (syncs, sleeps, output)
    assert log in caplog.text


def test_the_worker_syncs_again_only_when_due(worker, monkeypatch):
    naps = iter([None, Stop()])

    def sleep(seconds):
        worker.sleeps.append(seconds)
        nap = next(naps)
        if nap:
            raise nap

    monkeypatch.setattr(run_worker.time, "sleep", sleep)
    with pytest.raises(Stop):
        call_command("run_worker", stdout=io.StringIO())
    assert (worker.syncs, len(worker.sleeps)) == (1, 2)
