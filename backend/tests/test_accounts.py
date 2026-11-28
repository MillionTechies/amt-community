import httpx
import psycopg
import pytest
from amt_auth import OrgMembership, TokenClaims
from amt_auth.django.authentication import KeycloakAuthentication, KeycloakUser
from amt_auth.django.models import Organization
from amt_auth.exceptions import AdminAPIError
from django.core import mail
from django.db import connection
from django.urls import reverse
from django.utils import timezone
from model_bakery import baker

from apps.accounts import sync
from apps.accounts.authentication import ProfileAuthentication
from apps.accounts.models import Profile, RoleAssignment
from apps.accounts.serializers import initials
from tests.conftest import make_org, sign_in


@pytest.fixture
def root():
    return sign_in("root", platform_admin=True)


def test_me_shows_who_is_signed_in_and_what_they_manage(anonymous, admin, bob, org):
    assert anonymous.get(reverse("me")).status_code in (401, 403)
    me = admin.get(reverse("me")).json()
    assert me["email"] == "alice@example.com"
    assert (me["is_platform_admin"], me["judges_anything"]) == (False, False)
    assert me["organizations"] == [
        {
            "id": org.id, "name": "JKUAT", "alias": "jkuat", "is_admin": True, "roles": [],
            "can_manage_events": True, "can_manage_hackathons": True,
        }
    ]
    assert bob.get(reverse("me")).json()["organizations"] == []


def test_me_adds_an_organization_the_mirror_has_not_seen_yet():
    org = make_org("new")
    client = sign_in("dan", member_of=[org])
    org.delete()
    assert client.get(reverse("me")).json()["organizations"][0]["alias"] == "new"


def test_members_edit_their_profile_but_not_their_identity(bob):
    response = bob.patch(
        reverse("me"), {"headline": "Backend dev", "skills": ["Python", " Go "], "email": "x@y.z"}, format="json"
    )
    assert response.status_code == 200
    assert response.json()["headline"] == "Backend dev"
    assert response.json()["skills"] == ["Python", "Go"]
    assert response.json()["email"] == "bob@example.com"  # identity follows Keycloak
    # Skills are a list of words.
    assert bob.patch(reverse("me"), {"skills": "Python"}, format="json").status_code == 400
    assert bob.patch(reverse("me"), {"skills": ["Python", 3]}, format="json").status_code == 400


def test_org_admins_grant_and_revoke_roles_in_their_own_organization(admin, bob, org, other_org):
    roles = reverse("organization-roles", kwargs={"organization_id": org.id})
    unknown = admin.post(roles, {"email": "nobody@example.com", "role": "event_organiser"}, format="json")
    assert unknown.status_code == 400  # they have to sign in once first

    granted = admin.post(roles, {"email": "bob@example.com", "role": "event_organiser"}, format="json")
    assert granted.status_code == 201
    assert str(RoleAssignment.objects.get()) == "Bob is Event organiser at JKUAT"
    assert [r["email"] for r in admin.get(roles).json()] == ["bob@example.com"]
    assert bob.get(reverse("me")).json()["organizations"] == [
        {
            "id": org.id, "name": "JKUAT", "alias": "jkuat", "is_admin": False, "roles": ["event_organiser"],
            "can_manage_events": True, "can_manage_hackathons": False,
        }
    ]

    # Neither the role nor being an admin reaches into another organization.
    assert bob.get(roles).status_code == 403
    assert admin.get(reverse("organization-roles", kwargs={"organization_id": other_org.id})).status_code == 403

    revoke = reverse("organization-role", kwargs={"organization_id": org.id, "role_id": granted.json()["id"]})
    assert admin.delete(revoke).status_code == 204
    assert bob.get(reverse("me")).json()["organizations"] == []


def test_platform_admins_manage_only_their_own_organizations(org, other_org):
    root = sign_in("root", platform_admin=True, admin_of=[org])
    me = root.get(reverse("me")).json()
    assert me["is_platform_admin"] is True
    assert [o["alias"] for o in me["organizations"]] == ["jkuat"]
    assert root.get(reverse("organization-roles", kwargs={"organization_id": org.id})).status_code == 200
    assert root.get(reverse("organization-roles", kwargs={"organization_id": other_org.id})).status_code == 403


def test_initials_stand_in_for_names():
    assert initials("Alice Wanjiku Kamau") == "AK"
    assert initials("Bob") == "B"
    assert initials("") == "?"


# --- signing in ---------------------------------------------------------------------------


def claims(org_ids=(), email="erin@example.com", name="Erin Achieng"):
    memberships = tuple(OrgMembership(id=i, alias=i, groups=()) for i in org_ids)
    return TokenClaims(
        sub="sub-erin", email=email, name=name, given_name="Erin", family_name="Otieno",
        realm_roles=frozenset(), client_roles=frozenset(), memberships=memberships,
        active_organization=memberships[0] if memberships else None, raw={},
    )


@pytest.fixture
def token(monkeypatch):
    """Make amt-auth accept any request as carrying the claims set on `token.claims`."""

    class Token:
        claims = claims()

    monkeypatch.setattr(
        KeycloakAuthentication, "authenticate", lambda self, request: (KeycloakUser(Token.claims), Token.claims)
    )
    return Token


@pytest.fixture
def keycloak(monkeypatch):
    """Stands in for `sync_organization`: records the organizations asked for and mirrors them."""

    def sync_organization(org_id, admin, repo):
        sync_organization.calls.append(org_id)
        if sync_organization.error:
            raise sync_organization.error
        baker.make(Organization, id=org_id, name=f"Org {org_id}", alias=org_id, synced_at=timezone.now())

    sync_organization.calls = []
    sync_organization.error = None
    monkeypatch.setattr(sync, "_admin", lambda: object())
    monkeypatch.setattr(sync, "sync_organization", sync_organization)
    return sync_organization


def test_a_new_member_is_welcomed_once_then_follows_their_token(token, keycloak):
    ProfileAuthentication().authenticate(request=None)
    token.claims = claims(email="erin@new.example", name="")
    user, _ = ProfileAuthentication().authenticate(request=None)

    [welcome] = mail.outbox
    assert welcome.subject == "Welcome to A Million Techies Community"
    assert welcome.to == ["erin@example.com"]
    assert "Welcome, Erin!" in welcome.body
    profile = Profile.objects.get()
    assert (profile.email, profile.full_name) == ("erin@new.example", "Erin Otieno")
    assert str(profile) == "Erin Otieno"


def test_an_organization_new_to_the_mirror_is_synced_on_sign_in(token, keycloak):
    make_org("known")
    token.claims = claims(org_ids=("org-known", "org-new"))
    ProfileAuthentication().authenticate(request=None)
    ProfileAuthentication().authenticate(request=None)  # now known: no second Keycloak call
    assert keycloak.calls == ["org-new"]
    assert Organization.objects.get(id="org-new").name == "Org org-new"


@pytest.mark.parametrize("error", [AdminAPIError(500, "boom"), httpx.ConnectError("down")])
def test_signing_in_works_when_keycloak_cannot_be_reached(token, keycloak, error):
    keycloak.error = error
    token.claims = claims(org_ids=("org-new",))
    user, _ = ProfileAuthentication().authenticate(request=None)
    assert user.profile.sub == "sub-erin"
    assert not Organization.objects.filter(id="org-new").exists()


# --- syncing every organization -------------------------------------------------------------


def test_platform_admins_sync_every_organization_one_sync_at_a_time(root, monkeypatch):
    def keycloak_down(admin, repo):
        raise AdminAPIError(500, "boom")

    monkeypatch.setattr(sync, "_admin", lambda: object())
    monkeypatch.setattr(sync, "sync_all", lambda admin, repo: 3)
    db = connection.settings_dict
    with psycopg.connect(
        dbname=db["NAME"], user=db["USER"], password=db["PASSWORD"], host=db["HOST"], port=db["PORT"], autocommit=True,
    ) as worker:
        worker.execute("SELECT pg_advisory_lock(%s)", [sync.FULL_SYNC_LOCK])
        busy = root.post(reverse("organizations-sync"))
        worker.execute("SELECT pg_advisory_unlock(%s)", [sync.FULL_SYNC_LOCK])
    assert busy.status_code == 409
    assert busy.json() == {"detail": "A sync is already running."}
    assert root.post(reverse("organizations-sync")).json() == {"organizations": 3}

    monkeypatch.setattr(sync, "sync_all", keycloak_down)
    failed = root.post(reverse("organizations-sync"))
    assert failed.status_code == 502
    assert failed.json()["detail"] == "Keycloak request failed."


def test_sync_talks_to_amt_auths_keycloak_admin(monkeypatch):
    admin_api = object()

    class Service:
        admin = admin_api

    monkeypatch.setattr(sync.amt_authentication, "get_auth_service", lambda: Service())
    assert sync._admin() is admin_api
