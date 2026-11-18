"""Test helpers: members signed in with made-up Keycloak claims, no Keycloak needed."""

from datetime import timedelta

import pytest
from amt_auth import GroupRef, OrgMembership, TokenClaims
from amt_auth.django.authentication import KeycloakUser
from amt_auth.django.models import Organization
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Profile


@pytest.fixture(autouse=True)
def _db(db, settings):
    # Send emails straight away, into django.core.mail.outbox.
    settings.EMAIL_DELIVERY = "inline"
    settings.BACKGROUND_TASKS = "inline"
    # Configuration values are cached; each test starts from its own database.
    from apps.configuration import config

    config.forget()


def make_org(alias: str) -> Organization:
    return Organization.objects.create(
        id=f"org-{alias}", name=alias.upper(), alias=alias, synced_at=timezone.now()
    )


def sign_in(name: str, *, admin_of=(), member_of=(), platform_admin=False) -> APIClient:
    """An API client signed in as `name`, as amt-auth would after validating a token."""
    memberships = tuple(
        OrgMembership(
            id=org.id,
            alias=org.alias,
            groups=(GroupRef("/admins", org.id),) if org in admin_of else (),
        )
        for org in (*admin_of, *member_of)
    )
    claims = TokenClaims(
        sub=f"sub-{name}",
        email=f"{name}@example.com",
        name=name.title(),
        given_name=name.title(),
        family_name="",
        realm_roles=frozenset({"admin"} if platform_admin else ()),
        client_roles=frozenset(),
        memberships=memberships,
        active_organization=memberships[0] if memberships else None,
        raw={},
    )
    user = KeycloakUser(claims)
    user.profile, _ = Profile.objects.get_or_create(
        sub=claims.sub, defaults={"email": claims.email, "full_name": claims.name}
    )
    client = APIClient()
    client.force_authenticate(user=user, token=claims)
    client.profile = user.profile
    return client


@pytest.fixture
def org():
    return make_org("jkuat")


@pytest.fixture
def other_org():
    return make_org("uon")


@pytest.fixture
def admin(org):
    return sign_in("alice", admin_of=[org])


@pytest.fixture
def bob():
    return sign_in("bob")


@pytest.fixture
def carol():
    return sign_in("carol")


@pytest.fixture
def anonymous():
    return APIClient()


def in_days(days: float):
    return (timezone.now() + timedelta(days=days)).isoformat()
