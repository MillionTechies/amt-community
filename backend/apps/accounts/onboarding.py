"""Bringing a new organization onto Community once its application is approved.

Keycloak owns organizations, so approving an application creates one there, with the
groups every organization has (`admins`, `clubs`, `mentorships`), makes the applicant
a member and an admin, then copies it into the mirror. Each step can be repeated, so an
approval that fails part-way (Keycloak down, say) is simply tried again.
"""

from __future__ import annotations

from amt_auth.core.sync import sync_organization
from amt_auth.django.models import Organization
from amt_auth.django.repository import DjangoMirrorRepository
from amt_auth.exceptions import AdminAPIError
from django.db import transaction
from django.utils.text import slugify

from apps.accounts.sync import _admin

# The top-level groups every organization has; see amt_auth's README.
GROUPS = ("admins", "clubs", "mentorships")
ALREADY_EXISTS = 409


def suggest_alias(name: str) -> str:
    """A URL-safe alias for `name` that no organization has: "Moi University" -> "moi-university"."""
    base = slugify(name)[:60].strip("-") or "organization"
    taken = set(Organization.objects.filter(alias__startswith=base).values_list("alias", flat=True))
    candidates = (base if n == 1 else f"{base}-{n}" for n in range(1, len(taken) + 2))
    return next(c for c in candidates if c not in taken)


def _id_from(response) -> str:
    return response.headers["Location"].rstrip("/").rsplit("/", 1)[-1]


def _ensure_groups(admin, org_id: str) -> dict[str, str]:
    groups = {g["name"]: g["id"] for g in admin.list_org_groups(org_id)}
    for name in [n for n in GROUPS if n not in groups]:
        groups[name] = _id_from(admin._request("POST", f"/organizations/{org_id}/groups", json={"name": name}))
    return groups


def _add_member(admin, org_id: str, user_sub: str) -> None:
    try:
        admin.add_org_member(org_id, user_sub)
    except AdminAPIError as exc:
        if exc.status_code == ALREADY_EXISTS:  # a member already, from an earlier try
            return
        raise


def provision(application, alias: str) -> str:
    """Create the application's organization in Keycloak, with the applicant as its admin.

    Returns the Keycloak organization ID. Keycloak errors propagate; the ID is saved on
    the application as soon as the organization exists, so a retry carries on from there.
    """
    admin = _admin()
    if application.keycloak_id == "":
        application.keycloak_id = admin.create_organization(application.name, alias)
        application.save(update_fields=["keycloak_id", "updated_at"])
    org_id = application.keycloak_id
    groups = _ensure_groups(admin, org_id)
    _add_member(admin, org_id, application.applicant_id)
    admin._request("PUT", f"/organizations/{org_id}/groups/{groups['admins']}/members/{application.applicant_id}")
    with transaction.atomic():
        sync_organization(org_id, admin, DjangoMirrorRepository())
    return org_id
