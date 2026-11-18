"""Sending queued emails.

`deliver(ids)` is called after emails are queued. By default it sends them on a background
thread once the request's transaction commits, so the person clicking "Register" does not
wait for the mail server. The worker (`manage.py run_worker`) sends anything left over,
retries failures and sends reminders.
"""

import io
import logging
import threading
from datetime import timedelta
from email.mime.image import MIMEImage

import segno
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import close_old_connections, transaction
from django.utils import timezone

from apps.configuration.mail import sender as configured_sender
from apps.events.models import Registration
from apps.notifications import ticket
from apps.notifications.models import OutboundEmail

log = logging.getLogger(__name__)
MAX_ATTEMPTS = 5
# Emails that carry the PDF ticket.
TICKET_KINDS = {"registered", "promoted"}


def deliver(ids: list[int]) -> None:
    mode = getattr(settings, "EMAIL_DELIVERY", "thread")
    if not ids or mode == "worker":
        return
    if mode == "inline":
        send_queued(ids=ids)
        return

    def run():
        try:
            send_queued(ids=ids)
        finally:
            close_old_connections()

    transaction.on_commit(lambda: threading.Thread(target=run, daemon=True).start())


def _claim(ids, limit) -> list[OutboundEmail]:
    """Mark emails as being sent, so the worker and a request thread never both send one."""
    with transaction.atomic():
        queued = OutboundEmail.objects.select_for_update(skip_locked=True).filter(
            status=OutboundEmail.Status.QUEUED
        )
        if ids is not None:
            queued = queued.filter(id__in=ids)
        claimed = list(queued.order_by("created_at")[:limit])
        OutboundEmail.objects.filter(id__in=[e.id for e in claimed]).update(
            status=OutboundEmail.Status.SENDING, claimed_at=timezone.now()
        )
    return claimed


def _message(email: OutboundEmail) -> EmailMultiAlternatives:
    from_header, reply_to = configured_sender(email.event.organization_id if email.event_id else None)
    message = EmailMultiAlternatives(email.subject, email.text, from_header, [email.to], reply_to=reply_to)
    message.mixed_subtype = "related"
    message.attach_alternative(email.html, "text/html")
    if email.ticket_code:
        buffer = io.BytesIO()
        segno.make(email.ticket_code, error="m").save(buffer, kind="png", scale=8, border=2)
        image = MIMEImage(buffer.getvalue(), "png")
        image.add_header("Content-ID", "<ticket>")
        image.add_header("Content-Disposition", "inline", filename="ticket.png")
        message.attach(image)
    if email.ticket_code and email.kind in TICKET_KINDS:
        registration = (
            Registration.objects.select_related("event__organization", "profile")
            .filter(ticket_code=email.ticket_code).first()
        )
        if registration is not None:
            message.attach(ticket.filename(registration), ticket.build(registration), "application/pdf")
    if email.calendar:
        method = email.calendar_method or "PUBLISH"
        message.attach("invite.ics", email.calendar, f"text/calendar; method={method}; charset=utf-8")
    return message


def send_queued(ids=None, limit: int = 100) -> int:
    """Send queued emails (all, or just `ids`). Returns how many were sent."""
    sent = 0
    for email in _claim(ids, limit):
        email.attempts += 1
        try:
            _message(email).send()
        except Exception as error:  # the mail server said no, or could not be reached
            log.warning("Email %s to %s failed: %s", email.id, email.to, error)
            email.status = (
                OutboundEmail.Status.FAILED if email.attempts >= MAX_ATTEMPTS else OutboundEmail.Status.QUEUED
            )
            email.last_error = str(error)[:2000]
        else:
            email.status = OutboundEmail.Status.SENT
            email.sent_at = timezone.now()
            sent += 1
        email.save(update_fields=["status", "attempts", "last_error", "sent_at"])
    return sent


def release_stuck(older_than=timedelta(minutes=10)) -> int:
    """Put back emails whose sender died halfway (a restart mid-send)."""
    return OutboundEmail.objects.filter(
        status=OutboundEmail.Status.SENDING, claimed_at__lt=timezone.now() - older_than
    ).update(status=OutboundEmail.Status.QUEUED)
