from datetime import timedelta

from django.core import mail
from django.utils import timezone

from apps.events.models import Event
from apps.notifications import emails, sender
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
    assert "You're in, Bob" in message.body and "cid:ticket" in html and "meet.example.com/apis" in html
    name, content, kind = invite(message)
    assert kind.startswith("text/calendar; method=REQUEST") and "ATTENDEE" in content
    assert any(getattr(a, "get_content_type", lambda: "")() == "image/png" for a in message.attachments)
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
