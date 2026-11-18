"""What Community emails, and to whom. Each function queues emails, then hands them to `deliver`.

- registration confirmed (with the ticket QR code and a calendar invite), or waitlisted
- moved off the waiting list
- an announcement, when the organiser ticks "also email"
- the date, time, place or link changed (with the updated invite)
- the event was cancelled (with an invite that removes it from calendars)
- reminders a day and an hour before (queued by the worker)
"""

from datetime import timedelta
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import IntegrityError, transaction
from django.template.loader import render_to_string
from django.utils import timezone

from apps.content.richtext import to_text
from apps.events.models import Event, Registration
from apps.integrations import calendar, meetings
from apps.notifications.models import OutboundEmail
from apps.notifications.sender import deliver

LOCAL = ZoneInfo(settings.TIME_ZONE)


def when(event) -> str:
    """'Mon 30 Nov 2026, 09:00 to 17:30 (EAT)', in the community's time zone."""
    start, end = event.starts_at.astimezone(LOCAL), event.ends_at.astimezone(LOCAL)
    zone = start.tzname()
    if start.date() == end.date():
        return f"{start:%a %-d %b %Y, %H:%M} to {end:%H:%M} ({zone})"
    return f"{start:%a %-d %b %Y, %H:%M} to {end:%a %-d %b %Y, %H:%M} ({zone})"


def where(event) -> str:
    provider = meetings.detect(event.online_url)
    online = f"online on {provider['name']}" if provider else "online"
    if event.delivery_mode == Event.Mode.ONLINE:
        return online[0].upper() + online[1:]
    if event.delivery_mode == Event.Mode.HYBRID:
        return f"{event.venue or 'Venue to be confirmed'}, or {online}"
    return event.venue or "Venue to be confirmed"


def join_label(event) -> str:
    provider = meetings.detect(event.online_url)
    return f"Join on {provider['name']}" if provider else "Join online"


def _first_name(profile) -> str:
    return (profile.full_name or "").split(" ")[0] or "there"


def _render(subject: str, **context) -> tuple[str, str]:
    context = {
        "subject": subject,
        "paragraphs": [],
        "details": [],
        "changes": [],
        "community_url": settings.COMMUNITY_URL,
        "community_host": urlparse(settings.COMMUNITY_URL).netloc,
        **context,
    }
    return render_to_string("notifications/email.txt", context), render_to_string(
        "notifications/email.html", context
    )


def _queue(kind, profile, subject, *, event=None, key=None, invite=None, ticket="", **context):
    """Queue one email. Returns its id, or None when `key` shows it was already queued."""
    if not profile.email:
        return None
    text, html = _render(subject, ticket=ticket, **context)
    try:
        with transaction.atomic():
            email = OutboundEmail.objects.create(
                kind=kind, key=key, to=profile.email, subject=subject, text=text, html=html,
                event=event, ticket_code=ticket,
                calendar=invite.decode() if invite else "",
                calendar_method=("CANCEL" if b"METHOD:CANCEL" in invite else "REQUEST") if invite else "",
            )
    except IntegrityError:  # this key was queued before
        return None
    return email.id


def _event_details(event, *, with_link: bool):
    details = [("When", when(event)), ("Where", where(event))]
    if event.organization_id:
        details.append(("Hosted by", event.organization.name))
    return details


def _registration_email(registration, kind, subject, eyebrow, heading, paragraphs):
    event = registration.event
    attending = registration.status == Registration.Status.REGISTERED
    return _queue(
        kind, registration.profile, subject,
        event=event,
        invite=calendar.build(event, with_link=True, method="REQUEST", attendee=registration.profile) if attending else None,
        ticket=str(registration.ticket_code) if attending and event.delivery_mode != Event.Mode.ONLINE else "",
        preheader=f"{when(event)}. {where(event)}.",
        eyebrow=eyebrow, heading=heading, paragraphs=paragraphs,
        details=_event_details(event, with_link=attending),
        join_url=event.online_url if attending else "", join_label=join_label(event),
        button_url=calendar.event_url(event), button_label="View event",
        calendar_note="The invite attached adds it to your calendar." if attending else "",
    )


# --- registrations -----------------------------------------------------------------


def registration_changed(registration) -> None:
    """Right after someone registers or is waitlisted."""
    event = registration.event
    name = _first_name(registration.profile)
    if registration.status == Registration.Status.REGISTERED:
        email = _registration_email(
            registration, "registered", f"You're registered: {event.title}", "You're registered",
            f"You're in, {name}",
            [f"Your place at {event.title} is confirmed."],
        )
    elif registration.status == Registration.Status.WAITLISTED:
        email = _registration_email(
            registration, "waitlisted", f"You're on the waiting list: {event.title}", "Waiting list",
            f"You're on the waiting list, {name}",
            [f"{event.title} is full. If a place opens up, it is yours and we will email you straight away."],
        )
    else:
        return
    deliver([email] if email else [])


def promoted(registration) -> None:
    """Someone cancelled and a waitlisted person got the place."""
    event = registration.event
    email = _registration_email(
        registration, "promoted", f"A place opened up: you're registered for {event.title}",
        "Off the waiting list", f"Good news, {_first_name(registration.profile)}",
        [f"A place opened up at {event.title} and it is yours. You are now registered."],
    )
    deliver([email] if email else [])


# --- everyone registered -------------------------------------------------------------


def _attendees(event, *, waitlisted=False):
    statuses = [Registration.Status.REGISTERED]
    if waitlisted:
        statuses.append(Registration.Status.WAITLISTED)
    return event.registrations.filter(status__in=statuses).select_related("profile")


def announcement(announcement) -> int:
    event = announcement.event
    ids = [
        _queue(
            "announcement", r.profile, f"{event.title}: {announcement.title}",
            event=event, key=f"announcement:{announcement.id}:{r.profile_id}",
            preheader=to_text(announcement.body)[:140],
            eyebrow=f"Announcement · {event.title}", heading=announcement.title,
            body_html=announcement.body, body_text=to_text(announcement.body),
            button_url=calendar.event_url(event), button_label="View event",
        )
        for r in _attendees(event)
    ]
    ids = [i for i in ids if i]
    deliver(ids)
    return len(ids)


TRACKED = {
    "title": "Title",
    "starts_at": "Starts",
    "ends_at": "Ends",
    "delivery_mode": "Format",
    "venue": "Venue",
    "online_url": "Meeting link",
}


def snapshot(event) -> dict:
    return {field: getattr(event, field) for field in TRACKED}


def _show(field, value, event) -> str:
    if field in ("starts_at", "ends_at"):
        return f"{value.astimezone(LOCAL):%a %-d %b %Y, %H:%M}"
    if field == "delivery_mode":
        return Event.Mode(value).label
    if field == "online_url":
        provider = meetings.detect(value)
        return f"New {provider['name']} link" if provider and value else ("New link" if value else "Removed")
    return value or "Not set"


def event_changed(event, before: dict) -> int:
    """After an organiser edits a published event: tell registered people what changed."""
    if event.status != Event.Status.PUBLISHED:
        return 0
    changes = [
        (label, "" if field == "online_url" else _show(field, before[field], event), _show(field, getattr(event, field), event))
        for field, label in TRACKED.items()
        if before[field] != getattr(event, field)
    ]
    if not changes:
        return 0
    stamp = int(event.updated_at.timestamp())
    ids = [
        _queue(
            "changed", r.profile, f"Updated: {event.title}",
            event=event, key=f"changed:{event.id}:{stamp}:{r.profile_id}",
            invite=calendar.build(event, with_link=True, method="REQUEST", attendee=r.profile),
            preheader="The details of an event you registered for have changed.",
            eyebrow="Event updated", heading=f"{event.title} has changed",
            paragraphs=["The organisers updated this event. Here is what is different:"],
            changes=changes, details=_event_details(event, with_link=True),
            join_url=event.online_url, join_label=join_label(event),
            button_url=calendar.event_url(event), button_label="View event",
            calendar_note="The invite attached updates the event in your calendar.",
        )
        for r in _attendees(event)
    ]
    ids = [i for i in ids if i]
    deliver(ids)
    return len(ids)


def event_cancelled(event) -> int:
    ids = [
        _queue(
            "cancelled", r.profile, f"Cancelled: {event.title}",
            event=event, key=f"cancelled:{event.id}:{r.profile_id}",
            invite=calendar.build(event, with_link=False, method="REQUEST", attendee=r.profile)
            if r.status == Registration.Status.REGISTERED else None,
            preheader=f"{event.title} on {when(event)} will not go ahead.",
            eyebrow="Event cancelled", heading=f"{event.title} is cancelled",
            paragraphs=[
                f"Sorry, {_first_name(r.profile)}. The organisers have cancelled {event.title}, which was planned for {when(event)}.",
                "Your registration is closed. Keep an eye on Community for the next one.",
            ],
            button_url=f"{settings.COMMUNITY_URL}/events", button_label="See other events",
            calendar_note="The invite attached removes it from your calendar."
            if r.status == Registration.Status.REGISTERED else "",
        )
        for r in _attendees(event, waitlisted=True)
    ]
    ids = [i for i in ids if i]
    deliver(ids)
    return len(ids)


# --- reminders (queued by the worker) -------------------------------------------------

REMINDERS = [
    # (kind, how long before the start, wording)
    ("reminder_day", timedelta(hours=24), "Tomorrow"),
    ("reminder_hour", timedelta(hours=1), "Starting soon"),
]


def queue_reminders(now=None) -> int:
    """Queue any reminder that is due and not yet sent. Safe to run as often as you like."""
    now = now or timezone.now()
    ids = []
    for kind, ahead, wording in REMINDERS:
        # Due once we are within `ahead` of the start; skip it if we are already in the next
        # reminder's window, or past the start.
        events = Event.objects.filter(
            status=Event.Status.PUBLISHED, starts_at__gt=now, starts_at__lte=now + ahead
        ).select_related("organization")
        for event in events:
            if kind == "reminder_day" and event.starts_at - now <= timedelta(hours=1):
                continue
            # Someone who registered within the window (say 20 minutes before) needs no reminder.
            registered_before = event.starts_at - ahead
            for r in _attendees(event).filter(created_at__lt=registered_before):
                ids.append(
                    _queue(
                        kind, r.profile, f"{wording}: {event.title}",
                        event=event, key=f"{kind}:{event.id}:{r.profile_id}",
                        ticket=str(r.ticket_code) if event.delivery_mode != Event.Mode.ONLINE else "",
                        preheader=f"{when(event)}. {where(event)}.",
                        eyebrow=wording, heading=f"{event.title} {'is tomorrow' if kind == 'reminder_day' else 'starts in an hour'}",
                        paragraphs=[f"See you there, {_first_name(r.profile)}."],
                        details=_event_details(event, with_link=True),
                        join_url=event.online_url, join_label=join_label(event),
                        button_url=calendar.event_url(event), button_label="View event",
                    )
                )
    ids = [i for i in ids if i]
    deliver(ids)
    return len(ids)
