import httpx
import psycopg
import pytest
from amt_auth import OrgMembership, TokenClaims
from amt_auth.django.authentication import KeycloakAuthentication, KeycloakUser
from amt_auth.django.models import Organization
from amt_auth.exceptions import AdminAPIError
from django.core import mail
from django.db import connection
from django.utils import timezone

from apps.accounts import sync
from apps.accounts.authentication import ProfileAuthentication
from apps.accounts.models import RoleAssignment
from tests.conftest import make_org, sign_in


def test_me_requires_sign_in(anonymous):
    assert anonymous.get("/api/me/").status_code in (401, 403)


def test_me_reports_what_the_member_manages(admin, bob, org):
    me = admin.get("/api/me/").json()
    assert me["email"] == "alice@example.com"
    assert me["organizations"] == [
        {
            "id": org.id, "name": "JKUAT", "alias": "jkuat", "is_admin": True, "roles": [],
            "can_manage_events": True, "can_manage_hackathons": True,
        }
    ]
    assert bob.get("/api/me/").json()["organizations"] == []


def test_me_adds_an_organization_the_mirror_has_not_seen_yet():
    org = make_org("new")
    client = sign_in("dan", member_of=[org])
    org.delete()
    me = client.get("/api/me/").json()
    assert me["organizations"][0]["alias"] == "new"


def test_member_edits_own_profile(bob):
    response = bob.patch(
        "/api/me/", {"headline": "Backend dev", "skills": ["Python", " Go "], "email": "x@y.z"},
        format="json",
    )
    assert response.status_code == 200
    body = response.json()
    assert body["headline"] == "Backend dev"
    assert body["skills"] == ["Python", "Go"]
    assert body["email"] == "bob@example.com"  # identity fields follow Keycloak


def test_org_admin_grants_a_scoped_role(admin, bob, org, other_org):
    url = f"/api/organizations/{org.id}/roles/"
    granted = admin.post(url, {"email": "bob@example.com", "role": "event_organiser"}, format="json")
    assert granted.status_code == 201
    mine = bob.get("/api/me/").json()["organizations"]
    assert [(o["alias"], o["can_manage_events"], o["can_manage_hackathons"]) for o in mine] == [
        ("jkuat", True, False)
    ]
    # The role does not reach into another organization.
    assert bob.get(f"/api/organizations/{other_org.id}/roles/").status_code == 403
    assert admin.get(f"/api/organizations/{other_org.id}/roles/").status_code == 403

    assert admin.delete(f"{url}{granted.json()['id']}/").status_code == 204
    assert bob.get("/api/me/").json()["organizations"] == []


def test_role_needs_a_member_who_has_signed_in(admin, org):
    response = admin.post(
        f"/api/organizations/{org.id}/roles/",
        {"email": "nobody@example.com", "role": "event_organiser"}, format="json",
    )
    assert response.status_code == 400


def test_platform_admins_manage_only_their_own_organizations(org, other_org):
    root = sign_in("root", platform_admin=True, admin_of=[org])
    me = root.get("/api/me/").json()
    assert me["is_platform_admin"] is True
    assert [o["alias"] for o in me["organizations"]] == ["jkuat"]
    assert root.get(f"/api/organizations/{org.id}/roles/").status_code == 200
    assert root.get(f"/api/organizations/{other_org.id}/roles/").status_code == 403


def test_initials():
    from apps.accounts.serializers import initials

    assert initials("Alice Wanjiku Kamau") == "AK"
    assert initials("Bob") == "B"
    assert initials("") == "?"


# --- signing in: welcome email and organizations new to the mirror ----------------------


def _claims(sub="sub-erin", org_ids=()):
    memberships = tuple(OrgMembership(id=i, alias=i, groups=()) for i in org_ids)
    return TokenClaims(
        sub=sub, email="erin@example.com", name="Erin Achieng", given_name="Erin",
        family_name="Achieng", realm_roles=frozenset(), client_roles=frozenset(),
        memberships=memberships, active_organization=memberships[0] if memberships else None,
        raw={},
    )


@pytest.fixture
def token(monkeypatch):
    """Make amt-auth accept any request as carrying the claims set on `token.claims`."""

    class Token:
        claims = _claims()

    monkeypatch.setattr(
        KeycloakAuthentication, "authenticate", lambda self, request: (KeycloakUser(Token.claims), Token.claims)
    )
    return Token


@pytest.fixture
def keycloak(monkeypatch):
    """A fake Keycloak for `sync_organization`: records calls, creates the organization."""
    calls = []

    def fake_sync(org_id, admin, repo):
        calls.append(org_id)
        if fake_sync.error:
            raise fake_sync.error
        Organization.objects.create(id=org_id, name=f"Org {org_id}", alias=org_id, synced_at=timezone.now())

    fake_sync.error = None
    fake_sync.calls = calls
    monkeypatch.setattr(sync, "_admin", lambda: object())
    monkeypatch.setattr(sync, "sync_organization", fake_sync)
    return fake_sync


def test_a_new_member_is_welcomed_once(token, keycloak):
    ProfileAuthentication().authenticate(request=None)
    ProfileAuthentication().authenticate(request=None)
    welcomes = [m for m in mail.outbox if m.subject == "Welcome to A Million Techies Community"]
    assert len(welcomes) == 1
    assert welcomes[0].to == ["erin@example.com"]
    assert "Welcome, Erin!" in welcomes[0].body


def test_an_organization_new_to_the_mirror_is_synced_on_sign_in(token, keycloak):
    make_org("known")
    token.claims = _claims(org_ids=("org-known", "org-new"))
    ProfileAuthentication().authenticate(request=None)
    assert keycloak.calls == ["org-new"]
    assert Organization.objects.get(id="org-new").name == "Org org-new"
    # Now known: the next request does not call Keycloak.
    ProfileAuthentication().authenticate(request=None)
    assert keycloak.calls == ["org-new"]


@pytest.mark.parametrize("error", [AdminAPIError(500, "boom"), httpx.ConnectError("down")])
def test_signing_in_works_when_keycloak_cannot_be_reached(token, keycloak, error):
    keycloak.error = error
    token.claims = _claims(org_ids=("org-new",))
    user, claims = ProfileAuthentication().authenticate(request=None)
    assert user.profile.sub == "sub-erin"
    assert not Organization.objects.filter(id="org-new").exists()


@pytest.fixture
def full_sync(monkeypatch):
    monkeypatch.setattr(sync, "_admin", lambda: object())
    monkeypatch.setattr(sync, "sync_all", lambda admin, repo: 3)


def test_platform_admin_syncs_every_organization(full_sync):
    root = sign_in("root", platform_admin=True)
    response = root.post("/api/organizations/sync/")
    assert response.status_code == 200
    assert response.json() == {"organizations": 3}


def test_only_one_full_sync_runs_at_a_time(full_sync):
    root = sign_in("root", platform_admin=True)
    db = connection.settings_dict
    # Another process (the worker) holds the lock.
    with psycopg.connect(
        dbname=db["NAME"], user=db["USER"], password=db["PASSWORD"], host=db["HOST"], port=db["PORT"],
        autocommit=True,
    ) as other:
        other.execute("SELECT pg_advisory_lock(%s)", [sync.FULL_SYNC_LOCK])
        response = root.post("/api/organizations/sync/")
        assert response.status_code == 409
        assert response.json() == {"detail": "A sync is already running."}
        other.execute("SELECT pg_advisory_unlock(%s)", [sync.FULL_SYNC_LOCK])
    assert root.post("/api/organizations/sync/").status_code == 200


def test_a_failed_full_sync_reports_a_bad_gateway(monkeypatch):
    def fail(admin, repo):
        raise AdminAPIError(500, "boom")

    monkeypatch.setattr(sync, "_admin", lambda: object())
    monkeypatch.setattr(sync, "sync_all", fail)
    root = sign_in("root", platform_admin=True)
    response = root.post("/api/organizations/sync/")
    assert response.status_code == 502
    assert response.json()["detail"] == "Keycloak request failed."


def test_sync_talks_to_amt_auths_keycloak_admin(monkeypatch):
    admin_api = object()

    class Service:
        admin = admin_api

    monkeypatch.setattr(sync.amt_authentication, "get_auth_service", lambda: Service())
    assert sync._admin() is admin_api


def test_name_and_email_follow_the_token(token, keycloak):
    ProfileAuthentication().authenticate(request=None)
    token.claims = TokenClaims(
        sub="sub-erin", email="erin@new.example", name="", given_name="Erin", family_name="Otieno",
        realm_roles=frozenset(), client_roles=frozenset(), memberships=(), active_organization=None,
        raw={},
    )
    user, _ = ProfileAuthentication().authenticate(request=None)
    user.profile.refresh_from_db()
    assert (user.profile.email, user.profile.full_name) == ("erin@new.example", "Erin Otieno")
    assert str(user.profile) == "Erin Otieno"


def test_skills_must_be_a_list_of_words(bob):
    response = bob.patch("/api/me/", {"skills": "Python"}, format="json")
    assert response.status_code == 400
    assert bob.patch("/api/me/", {"skills": ["Python", 3]}, format="json").status_code == 400


def test_role_assignment_reads_as_a_sentence(admin, bob, org):
    admin.post(f"/api/organizations/{org.id}/roles/", {"email": "bob@example.com", "role": "hackathon_manager"}, format="json")
    assignment = RoleAssignment.objects.get()
    assert str(assignment) == "Bob is Hackathon manager at JKUAT"
