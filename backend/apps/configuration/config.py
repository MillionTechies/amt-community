"""Reading settings: the organisation's value, else the platform's, else the environment.

    from apps.configuration import config
    config.get("google.client_id", organization_id)
"""

from django.conf import settings
from django.core.cache import cache

from apps.configuration.registry import FIELDS

CACHE_KEY = "configuration:values"
CACHE_SECONDS = 60


def _stored() -> dict:
    """{(organization_id or None, key): plain value}, cached briefly and cleared on save."""
    values = cache.get(CACHE_KEY)
    if values is None:
        from apps.configuration.models import Setting, unseal

        values = {}
        for row in Setting.objects.all():
            field = FIELDS.get(row.key)
            if field is None:
                continue
            values[(row.organization_id, row.key)] = unseal(row.value) if field.kind == "secret" else row.value
        cache.set(CACHE_KEY, values, CACHE_SECONDS)
    return values


def forget() -> None:
    cache.delete(CACHE_KEY)


def from_environment(key: str) -> str:
    field = FIELDS[key]
    if field.env:
        value = getattr(settings, field.env, None)
        if value not in (None, ""):
            if isinstance(value, bool):
                return "true" if value else "false"
            return str(value)
    return field.default


def lookup(key: str, organization_id: str | None = None) -> tuple[str, str]:
    """(value, where it came from: "organization", "platform", "environment" or "default")."""
    stored = _stored()
    if organization_id and stored.get((organization_id, key), "") != "":
        return stored[(organization_id, key)], "organization"
    if stored.get((None, key), "") != "":
        return stored[(None, key)], "platform"
    value = from_environment(key)
    field = FIELDS[key]
    source = "environment" if value and value != field.default else ("default" if value else "")
    return value, source


def get(key: str, organization_id: str | None = None) -> str:
    return lookup(key, organization_id)[0]


def get_bool(key: str, organization_id: str | None = None) -> bool:
    return get(key, organization_id).lower() in ("true", "1", "yes", "on")


def has_own(group_id: str, organization_id: str, required: tuple[str, ...]) -> bool:
    """Whether the organisation has set all of `required` itself (its own app)."""
    stored = _stored()
    return all(stored.get((organization_id, key), "") != "" for key in required)
