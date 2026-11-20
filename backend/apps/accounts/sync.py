"""Keeping amt-auth's organization mirror in step with Keycloak.

Keycloak cannot push changes to us, so the mirror catches up two ways:
- as soon as a member's token names an organization the mirror does not have
  (`sync_new_organizations`, called on every authenticated request; it costs
  one query and no Keycloak call when nothing is new);
- a full sync now and then from the worker, or when a platform admin presses
  Sync (`locked_sync_all`, never two at once).
"""

from __future__ import annotations

import logging

import httpx
from amt_auth.core.sync import sync_all, sync_organization
from amt_auth.django import authentication as amt_authentication
from amt_auth.django.models import Organization
from amt_auth.django.repository import DjangoMirrorRepository
from amt_auth.exceptions import AdminAPIError
from django.db import connection, transaction

log = logging.getLogger(__name__)

# PostgreSQL advisory lock key held by whoever is running a full sync.
FULL_SYNC_LOCK = 0x616D7473  # "amts"


def _admin():
    return amt_authentication.get_auth_service().admin


def locked_sync_all() -> int | None:
    """Sync every organization, unless a full sync is already running.

    Returns the number of organizations synced, or None when it skipped because
    another full sync holds the lock. Keycloak errors propagate to the caller.
    """
    with transaction.atomic():
        with connection.cursor() as cursor:
            # Released when this transaction ends.
            cursor.execute("SELECT pg_try_advisory_xact_lock(%s)", [FULL_SYNC_LOCK])
            if not cursor.fetchone()[0]:
                return None
        return sync_all(_admin(), DjangoMirrorRepository())


def sync_new_organizations(claims) -> None:
    """Sync the organizations in the token that the mirror has never seen.

    Organizations the mirror already has (even soft-deleted ones) are left to the
    full sync, so a stale token never causes a Keycloak call on every request.
    A Keycloak failure is logged, never raised: signing in must not depend on it.
    """
    ids = {m.id for m in claims.memberships}
    if not ids:
        return
    known = set(Organization.objects.filter(id__in=ids).values_list("id", flat=True))
    for org_id in ids - known:
        try:
            with transaction.atomic():
                sync_organization(org_id, _admin(), DjangoMirrorRepository())
        except (AdminAPIError, httpx.HTTPError):
            log.warning("Could not sync new organization %s from Keycloak", org_id, exc_info=True)
