"""Calendar invites (.ics) for events, readable by Google, Outlook, Apple and every other calendar.

One event keeps one UID, and SEQUENCE grows with every edit, so a calendar that already has
the event updates it in place instead of adding a copy. A cancelled event is sent with
STATUS:CANCELLED (and METHOD:CANCEL in emails), which removes it from people's calendars.
"""

from email.utils import parseaddr

from django.conf import settings
from icalendar import Calendar, Event as VEvent, vCalAddress, vText

from apps.content.richtext import to_text
from apps.integrations import meetings

PRODID = "-//A Million Techies//Community//EN"


def event_url(event) -> str:
    return f"{settings.COMMUNITY_URL}/events/{event.slug}"


def sequence(event) -> int:
    """Grows with every save, as calendars require for updates."""
    return max(0, int(event.updated_at.timestamp() - event.created_at.timestamp()))


def describe(event, with_link: bool) -> str:
    parts = []
    if with_link and event.online_url:
        provider = meetings.detect(event.online_url)
        parts.append(f"Join {'on ' + provider['name'] if provider else 'online'}: {event.online_url}")
    summary = event.summary or to_text(event.description)[:600]
    if summary:
        parts.append(summary)
    parts.append(f"Event page: {event_url(event)}")
    return "\n\n".join(parts)


def location(event, with_link: bool) -> str:
    if event.venue and event.delivery_mode != "online":
        return event.venue
    if with_link and event.online_url:
        return event.online_url
    provider = meetings.detect(event.online_url)
    return f"Online ({provider['name']})" if provider else "Online"


def build(event, *, with_link: bool, method: str = "PUBLISH", attendee=None) -> bytes:
    """An .ics file for `event`. `with_link` adds the meeting link (for people registered)."""
    cancelled = event.status == event.Status.CANCELLED
    calendar = Calendar()
    calendar.add("prodid", PRODID)
    calendar.add("version", "2.0")
    calendar.add("calscale", "GREGORIAN")
    calendar.add("method", "CANCEL" if cancelled and method == "REQUEST" else method)

    item = VEvent()
    item.add("uid", f"event-{event.slug}@community.amilliontechies.com")
    item.add("sequence", sequence(event))
    item.add("dtstamp", event.updated_at)
    item.add("dtstart", event.starts_at)
    item.add("dtend", event.ends_at)
    item.add("summary", event.title)
    item.add("description", describe(event, with_link))
    item.add("location", location(event, with_link))
    item.add("url", event_url(event))
    item.add("status", "CANCELLED" if cancelled else "CONFIRMED")
    if method == "REQUEST":
        organizer = vCalAddress(f"mailto:{parseaddr(settings.DEFAULT_FROM_EMAIL)[1]}")
        organizer.params["cn"] = vText(event.organization.name)
        item["organizer"] = organizer
        if attendee is not None:
            address = vCalAddress(f"mailto:{attendee.email}")
            address.params["cn"] = vText(attendee.full_name or attendee.email)
            address.params["role"] = vText("REQ-PARTICIPANT")
            address.params["partstat"] = vText("ACCEPTED")
            item.add("attendee", address, encode=0)
    calendar.add_component(item)
    return calendar.to_ical()
