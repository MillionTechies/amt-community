"""Organisations applying to join Community, and platform admins approving or declining them."""

import httpx
import pytest
from amt_auth.django.models import Organization
from amt_auth.exceptions import AdminAPIError
from django.core import mail
from django.utils import timezone

from apps.accounts import onboarding
from apps.accounts.models import OrganizationApplication
from tests.conftest import make_org, sign_in

FORM = {
    "name": "Moi University",
    "kind": "institution",
    "website": "https://mu.ac.ke",
    "location": "Eldoret",
    "about": "A public university in Eldoret.",
    "plans": "Monthly meetups and a yearly hackathon.",
}


class FakeKeycloak:
    """Records what Community asks Keycloak to do."""

    def __init__(self, groups=(), create_error=None, member_error=None):
        self.groups = [{"name": name, "id": f"g-{name}"} for name in groups]
        self.create_error = create_error
        self.member_error = member_error
        self.calls = []

    def create_organization(self, name, alias):
        self.calls.append(("create", name, alias))
        if self.create_error:
            raise self.create_error
        return "kc-moi"

    def list_org_groups(self, org_id):
        return self.groups

    def add_org_member(self, org_id, user_id):
        self.calls.append(("member", org_id, user_id))
        if self.member_error:
            raise self.member_error

    def _request(self, method, path, json=None):
        self.calls.append((method, path, json))
        name = (json or {}).get("name", "")
        return httpx.Response(201, headers={"Location": f"https://kc/admin/{path}/g-{name}/"})


@pytest.fixture
def keycloak(monkeypatch):
    fake = FakeKeycloak()
    synced = []

    def fake_sync(org_id, admin, repo):
        synced.append(org_id)
        Organization.objects.create(id=org_id, name="Moi University", alias="moi-university", synced_at=timezone.now())

    monkeypatch.setattr(onboarding, "_admin", lambda: fake)
    monkeypatch.setattr(onboarding, "sync_organization", fake_sync)
    fake.synced = synced
    return fake


@pytest.fixture
def root():
    return sign_in("root", platform_admin=True)


def apply(client, **changes):
    return client.post("/api/organizations/applications/", {**FORM, **changes}, format="json")


# --- applying ---------------------------------------------------------------------


def test_a_member_applies_and_gets_a_confirmation(bob):
    response = apply(bob, name="  Moi University ")
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Moi University"
    assert body["status"] == "pending"
    assert body["kind_label"] == "University, college or school"
    assert body["organization_id"] == ""
    assert [m.subject for m in mail.outbox] == ["We received your application for Moi University"]
    assert mail.outbox[0].to == ["bob@example.com"]
    assert bob.get("/api/organizations/applications/").json()[0]["id"] == body["id"]


def test_members_see_only_their_own_applications(bob, carol):
    apply(bob)
    assert carol.get("/api/organizations/applications/").json() == []


def test_signing_in_is_needed_to_apply(anonymous):
    assert apply(anonymous).status_code in (401, 403)


def test_an_organisation_already_on_community_cannot_apply_again(bob, org):
    response = apply(bob, name="jkuat")
    assert response.status_code == 400
    assert "already on Community" in response.json()["name"][0]


def test_one_pending_application_per_organisation(bob, carol):
    apply(bob)
    response = apply(bob, name="moi university")
    assert response.status_code == 400
    assert "already applied" in response.json()["name"][0]
    # Someone else from the same place may still apply; admins see both.
    assert apply(carol).status_code == 201


def test_about_and_kind_are_required(bob):
    response = bob.post("/api/organizations/applications/", {"name": "X"}, format="json")
    assert set(response.json()) == {"kind", "about"}


# --- reviewing ----------------------------------------------------------------------


def test_only_platform_admins_review(bob, admin):
    apply(bob)
    application = OrganizationApplication.objects.get()
    for client in (bob, admin):
        assert client.get("/api/platform/applications/").status_code == 403
        assert client.post(f"/api/platform/applications/{application.id}/decline/", {"note": "x"}).status_code == 403


def test_platform_admins_see_every_application_with_a_suggested_alias(bob, root):
    make_org("moi-university")
    apply(bob)
    [row] = root.get("/api/platform/applications/").json()
    assert row["applicant"] == {"sub": "sub-bob", "name": "Bob", "email": "bob@example.com", "institution": ""}
    assert row["suggested_alias"] == "moi-university-2"
    assert row["reviewed_by"] == ""


def test_approving_creates_the_organisation_with_the_applicant_as_admin(bob, root, keycloak):
    apply(bob)
    application = OrganizationApplication.objects.get()
    mail.outbox.clear()
    response = root.post(
        f"/api/platform/applications/{application.id}/approve/",
        {"alias": "Moi-University", "note": "Welcome!"}, format="json",
    )
    assert response.status_code == 200
    row = response.json()
    assert row["status"] == "approved"
    assert row["organization_id"] == "kc-moi"
    assert row["reviewed_by"] == "Root"
    assert row["suggested_alias"] == ""
    assert keycloak.calls == [
        ("create", "Moi University", "moi-university"),
        ("POST", "/organizations/kc-moi/groups", {"name": "admins"}),
        ("POST", "/organizations/kc-moi/groups", {"name": "clubs"}),
        ("POST", "/organizations/kc-moi/groups", {"name": "mentorships"}),
        ("member", "kc-moi", "sub-bob"),
        ("PUT", "/organizations/kc-moi/groups/g-admins/members/sub-bob", None),
    ]
    assert keycloak.synced == ["kc-moi"]
    assert Organization.objects.filter(id="kc-moi").exists()
    [email] = mail.outbox
    assert email.subject == "Moi University is now on A Million Techies Community"
    assert "Welcome!" in email.body
    # Decided applications cannot be decided again.
    assert root.post(f"/api/platform/applications/{application.id}/decline/", {"note": "x"}).status_code == 404


def test_a_retry_carries_on_where_keycloak_stopped(bob, root, keycloak):
    apply(bob)
    application = OrganizationApplication.objects.get()
    application.keycloak_id = "kc-moi"
    application.save()
    keycloak.groups = [{"name": "admins", "id": "g-admins"}, {"name": "clubs", "id": "g-clubs"}]
    keycloak.member_error = AdminAPIError(409, "already a member")
    response = root.post(f"/api/platform/applications/{application.id}/approve/", {"alias": "moi"}, format="json")
    assert response.status_code == 200
    assert keycloak.calls == [
        ("POST", "/organizations/kc-moi/groups", {"name": "mentorships"}),
        ("member", "kc-moi", "sub-bob"),
        ("PUT", "/organizations/kc-moi/groups/g-admins/members/sub-bob", None),
    ]


def test_a_taken_alias_asks_for_another(bob, root, keycloak):
    apply(bob)
    application = OrganizationApplication.objects.get()
    keycloak.create_error = AdminAPIError(409, "exists")
    response = root.post(f"/api/platform/applications/{application.id}/approve/", {"alias": "moi"}, format="json")
    assert response.status_code == 400
    assert "Pick another alias" in response.json()["alias"]
    application.refresh_from_db()
    assert application.status == "pending"


def test_keycloak_failing_is_a_bad_gateway_and_nothing_is_decided(bob, root, keycloak):
    apply(bob)
    application = OrganizationApplication.objects.get()
    keycloak.member_error = AdminAPIError(500, "boom")
    response = root.post(f"/api/platform/applications/{application.id}/approve/", {"alias": "moi"}, format="json")
    assert response.status_code == 502
    application.refresh_from_db()
    assert application.status == "pending"
    assert application.keycloak_id == "kc-moi"  # kept, so the retry does not create it twice


def test_an_alias_must_be_url_safe(bob, root, keycloak):
    apply(bob)
    application = OrganizationApplication.objects.get()
    response = root.post(f"/api/platform/applications/{application.id}/approve/", {"alias": "moi uni"}, format="json")
    assert response.status_code == 400
    assert keycloak.calls == []


def test_declining_needs_a_reason_and_emails_it(bob, root):
    apply(bob)
    application = OrganizationApplication.objects.get()
    mail.outbox.clear()
    assert root.post(f"/api/platform/applications/{application.id}/decline/", {}, format="json").status_code == 400
    response = root.post(
        f"/api/platform/applications/{application.id}/decline/",
        {"note": "Please apply with an official email address."}, format="json",
    )
    assert response.json()["status"] == "declined"
    [email] = mail.outbox
    assert email.subject == "About your application for Moi University"
    assert "official email address" in email.body
    assert bob.get("/api/organizations/applications/").json()[0]["review_note"] == "Please apply with an official email address."


def test_pending_applications_show_on_the_platform_overview(bob, carol, root):
    apply(bob)
    attention = root.get("/api/platform/overview/").json()["attention"]
    assert {"kind": "application", "title": "1 organisation is waiting to join", "detail": "Review their applications.", "link": "/platform/applications"} in attention
    apply(carol, name="PyData Nairobi", kind="community")
    titles = [a["title"] for a in root.get("/api/platform/overview/").json()["attention"]]
    assert "2 organisations are waiting to join" in titles


# --- aliases --------------------------------------------------------------------------


def test_suggested_aliases_are_url_safe_and_unused():
    assert onboarding.suggest_alias("Moi University") == "moi-university"
    make_org("moi-university")
    make_org("moi-university-2")
    assert onboarding.suggest_alias("Moi University") == "moi-university-3"
    assert onboarding.suggest_alias("!!!") == "organization"


def test_the_model_reads_well():
    profile = sign_in("dan").profile
    application = OrganizationApplication.objects.create(applicant=profile, name="PyData", kind="community", about="x")
    assert str(application) == "PyData (Waiting for review)"
