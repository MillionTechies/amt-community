"""Connecting accounts, and keeping an event's copies in Google, Outlook and Zoom up to date."""

from datetime import timedelta

from django.core import signing
from django.utils import timezone

from apps.events.models import Event
from apps.integrations.background import run_later
from apps.integrations.models import Connection, EventLink
from apps.integrations.providers import PROVIDERS, ProviderError

STATE_SALT = "integrations.oauth.state"
STATE_MAX_AGE = 15 * 60


def make_state(profile, provider_id: str) -> str:
    return signing.dumps({"p": profile.pk, "v": provider_id}, salt=STATE_SALT)


def read_state(state: str, provider_id: str) -> int:
    """The profile id the sign-in was started for. Raises signing.BadSignature if forged or old."""
    data = signing.loads(state, salt=STATE_SALT, max_age=STATE_MAX_AGE)
    if data.get("v") != provider_id:
        raise signing.BadSignature("State is for another provider.")
    return data["p"]


def _expiry(tokens: dict):
    seconds = tokens.get("expires_in")
    return timezone.now() + timedelta(seconds=int(seconds) - 60) if seconds else None


def connect(profile, provider_id: str, code: str) -> Connection:
    provider = PROVIDERS[provider_id]
    tokens = provider.exchange(code)
    connection, _ = Connection.objects.get_or_create(
        profile=profile, provider=provider_id, defaults={"access_token_sealed": ""}
    )
    connection.access_token = tokens["access_token"]
    if tokens.get("refresh_token"):
        connection.refresh_token = tokens["refresh_token"]
    connection.expires_at = _expiry(tokens)
    connection.account_email = provider.account_email(tokens) or connection.account_email
    connection.save()
    return connection


def token_for(connection: Connection) -> str:
    """A working access token, refreshed first if it has expired."""
    if connection.expires_at and connection.expires_at <= timezone.now():
        if not connection.refresh_token:
            raise ProviderError(f"Your {connection.get_provider_display()} connection has expired. Connect it again.")
        tokens = PROVIDERS[connection.provider].refresh(connection.refresh_token)
        connection.access_token = tokens["access_token"]
        if tokens.get("refresh_token"):
            connection.refresh_token = tokens["refresh_token"]
        connection.expires_at = _expiry(tokens)
        connection.save(update_fields=["access_token_sealed", "refresh_token_sealed", "expires_at", "updated_at"])
    return connection.access_token


def link_event(connection: Connection, event: Event, *, meeting: bool) -> EventLink:
    """Put the event in the connected calendar (and make a meeting, if asked).

    A new meeting becomes the event's join link. If the event is already there through this
    connection, the old copy is replaced.
    """
    provider = PROVIDERS[connection.provider]
    token = token_for(connection)
    existing = EventLink.objects.filter(event=event, connection=connection).first()
    if existing:
        provider.delete(token, existing.external_id)
        existing.delete()
    external_id, join_url = provider.create(token, event, meeting=meeting)
    link = EventLink.objects.create(
        event=event, connection=connection, external_id=external_id, is_meeting=bool(meeting and join_url), join_url=join_url
    )
    if link.is_meeting:
        event.online_url = join_url
        if event.delivery_mode == Event.Mode.IN_PERSON:
            event.delivery_mode = Event.Mode.HYBRID
        event.save(update_fields=["online_url", "delivery_mode", "updated_at"])
        # The calendar copy should show the meeting link too.
        if provider.has_calendar:
            provider.update(token, external_id, event)
    return link


def unlink_event(link: EventLink) -> None:
    PROVIDERS[link.connection.provider].delete(token_for(link.connection), link.external_id)
    event = link.event
    if link.is_meeting and event.online_url == link.join_url:
        event.online_url = ""
        event.save(update_fields=["online_url", "updated_at"])
    link.delete()


def _push(event_id: int) -> None:
    event = Event.objects.select_related("organization").get(pk=event_id)
    for link in EventLink.objects.filter(event=event).select_related("connection"):
        provider = PROVIDERS[link.connection.provider]
        token = token_for(link.connection)
        if event.status == Event.Status.CANCELLED:
            provider.delete(token, link.external_id)
            link.delete()
        else:
            provider.update(token, link.external_id, event)
            link.save(update_fields=["synced_at"])


def push_changes(event: Event) -> None:
    """After an event changes or is cancelled, update (or remove) its copies elsewhere."""
    if EventLink.objects.filter(event=event).exists():
        run_later(_push, event.pk)


def disconnect(connection: Connection) -> None:
    """Forget the account. Copies already made stay in the organiser's calendar."""
    connection.delete()
