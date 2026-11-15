"""Who may manage what.

Access is scoped to an organization:
- platform admins (realm role `admin`) manage every organization;
- an organization's admins (its `/admins` group) manage everything in it;
- event organisers and hackathon managers hold a RoleAssignment in it.
"""

from __future__ import annotations

from amt_auth.django.permissions import PLATFORM_ADMIN_ROLE
from rest_framework.exceptions import PermissionDenied

from apps.accounts.models import RoleAssignment

Role = RoleAssignment.Role


def claims_of(request):
    return getattr(request.user, "claims", None)


def profile_of(request):
    return getattr(request.user, "profile", None)


def is_platform_admin(request) -> bool:
    claims = claims_of(request)
    return claims is not None and PLATFORM_ADMIN_ROLE in claims.realm_roles


def admin_org_ids(request) -> set[str]:
    claims = claims_of(request)
    return {m.id for m in claims.memberships if m.is_admin} if claims else set()


def is_org_admin(request, organization_id: str) -> bool:
    return is_platform_admin(request) or organization_id in admin_org_ids(request)


def managed_org_ids(request, role: str) -> set[str]:
    """Organizations where the user is an admin or holds `role`. Platform admins: see `can_manage`."""
    profile = profile_of(request)
    if profile is None:
        return set()
    granted = RoleAssignment.objects.filter(profile=profile, role=role).values_list(
        "organization_id", flat=True
    )
    return admin_org_ids(request) | set(granted)


def can_manage(request, organization_id: str, role: str) -> bool:
    if claims_of(request) is None:
        return False
    return is_platform_admin(request) or organization_id in managed_org_ids(request, role)


def require_manage(request, organization_id: str, role: str) -> None:
    if not can_manage(request, organization_id, role):
        raise PermissionDenied("You do not manage this organisation's programmes.")
