"""Organisations applying to join Community, and platform admins approving or declining them."""

import httpx
import pytest
from amt_auth.django.models import Organization
from amt_auth.exceptions import AdminAPIError
from django.core import mail
from django.urls import reverse
from django.utils import timezone
from model_bakery import baker

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
    """Records what Community asks Keycloak to do. `errors` maps a call to the error it raises."""

    def __init__(self):
        self.groups = []
        self.errors = {}
        self.calls = []

    def create_organization(self, name, alias):
        self.calls.append(("create", name, alias))
        if name in self.errors:
            raise self.errors[name]
        return f"kc-{alias.split('-')[0]}"

    def list_org_groups(self, org_id):
        return self.groups

    def add_org_member(self, org_id, user_id):
        self.calls.append(("member", org_id, user_id))
        if "member" in self.errors:
            raise self.errors["member"]

    def _request(self, method, path, json=None):
        self.calls.append((method, path, json))
        return httpx.Response(201, headers={"Location": f"https://kc/admin{path}/g-{(json or {}).get('name')}/"})


@pytest.fixture
def keycloak(monkeypatch):
    fake = FakeKeycloak()

    def sync_organization(org_id, admin, repo):
        baker.make(Organization, id=org_id, name=org_id, alias=org_id, synced_at=timezone.now())

    monkeypatch.setattr(onboarding, "_admin", lambda: fake)
    monkeypatch.setattr(onboarding, "sync_organization", sync_organization)
    return fake


@pytest.fixture
def root():
    return sign_in("root", platform_admin=True)


@pytest.fixture
def application(bob):
    return baker.make(OrganizationApplication, applicant=bob.profile, name="Moi University", kind="institution")


def approve(client, application, **body):
    return client.post(reverse("platform-application-approve", kwargs={"application_id": application.id}), body, format="json")


def decline(client, application, **body):
    return client.post(reverse("platform-application-decline", kwargs={"application_id": application.id}), body, format="json")


def bulk(client, **body):
    return client.post(reverse("platform-applications-bulk"), body, format="json")


# --- applying ---------------------------------------------------------------------------


def test_a_member_applies_and_follows_their_application(anonymous, bob, carol):
    applications = reverse("organization-applications")
    assert anonymous.post(applications, FORM, format="json").status_code in (401, 403)

    response = bob.post(applications, {**FORM, "name": "  Moi University "}, format="json")
    assert response.status_code == 201
    assert response.json()["name"] == "Moi University"
    assert response.json()["status"] == "pending"
    assert response.json()["kind_label"] == "University, college or school"
    assert response.json()["organization_id"] == ""
    assert str(OrganizationApplication.objects.get()) == "Moi University (Waiting for review)"
    [email] = mail.outbox
    assert email.subject == "We received your application for Moi University"
    assert email.to == ["bob@example.com"]
    assert [a["id"] for a in bob.get(applications).json()] == [response.json()["id"]]
    assert carol.get(applications).json() == []


def test_an_organisation_can_apply_only_once_and_only_when_new(bob, carol, org, application):
    applications = reverse("organization-applications")
    on_community = bob.post(applications, {**FORM, "name": "jkuat"}, format="json")
    assert "already on Community" in on_community.json()["name"][0]
    applied = bob.post(applications, {**FORM, "name": "moi university"}, format="json")
    assert "already applied" in applied.json()["name"][0]
    assert set(bob.post(applications, {"name": "X"}, format="json").json()) == {"kind", "about"}
    # Someone else from the same place may still apply.
    assert carol.post(applications, FORM, format="json").status_code == 201


# --- reviewing ----------------------------------------------------------------------------


def test_only_platform_admins_review(admin, application):
    # Not even an organisation's own admin.
    assert admin.get(reverse("platform-applications")).status_code == 403
    assert decline(admin, application, note="x").status_code == 403
    assert bulk(admin, ids=[application.id], decision="decline", note="x").status_code == 403


def test_platform_admins_see_every_application_with_an_unused_url_safe_alias(root, application):
    make_org("moi-university")
    [row] = root.get(reverse("platform-applications")).json()
    assert row["applicant"] == {"sub": "sub-bob", "name": "Bob", "email": "bob@example.com", "institution": ""}
    assert row["suggested_alias"] == "moi-university-2"
    assert row["reviewed_by"] == ""
    make_org("moi-university-2")
    assert onboarding.suggest_alias("Moi University") == "moi-university-3"
    assert onboarding.suggest_alias("!!!") == "organization"


def test_approving_creates_the_organisation_with_the_applicant_as_admin(root, application, keycloak):
    response = approve(root, application, alias="Moi-University", note="Welcome!")
    assert response.status_code == 200
    assert response.json()["status"] == "approved"
    assert response.json()["organization_id"] == "kc-moi"
    assert response.json()["reviewed_by"] == "Root"
    assert response.json()["suggested_alias"] == ""
    assert keycloak.calls == [
        ("create", "Moi University", "moi-university"),
        ("POST", "/organizations/kc-moi/groups", {"name": "admins"}),
        ("POST", "/organizations/kc-moi/groups", {"name": "clubs"}),
        ("POST", "/organizations/kc-moi/groups", {"name": "mentorships"}),
        ("member", "kc-moi", "sub-bob"),
        ("PUT", "/organizations/kc-moi/groups/g-admins/members/sub-bob", None),
    ]
    assert Organization.objects.filter(id="kc-moi").exists()
    [email] = mail.outbox
    assert email.subject == "Moi University is now on A Million Techies Community"
    assert "Welcome!" in email.body
    # Decided applications cannot be decided again.
    assert decline(root, application, note="x").status_code == 404


def test_a_retry_carries_on_where_keycloak_stopped(root, bob, keycloak):
    application = baker.make(OrganizationApplication, applicant=bob.profile, name="Moi University", keycloak_id="kc-moi")
    keycloak.groups = [{"name": "admins", "id": "g-admins"}, {"name": "clubs", "id": "g-clubs"}]
    keycloak.errors["member"] = AdminAPIError(409, "already a member")
    assert approve(root, application, alias="moi").status_code == 200
    assert keycloak.calls == [
        ("POST", "/organizations/kc-moi/groups", {"name": "mentorships"}),
        ("member", "kc-moi", "sub-bob"),
        ("PUT", "/organizations/kc-moi/groups/g-admins/members/sub-bob", None),
    ]


@pytest.mark.parametrize(
    "alias, errors, status, detail, keycloak_id",
    [
        ("moi uni", {}, 400, "valid", ""),  # not URL-safe: Keycloak is not asked
        ("moi", {"Moi University": AdminAPIError(409, "exists")}, 400, "Pick another alias", ""),
        # The organisation is kept, so a retry does not create it twice.
        ("moi", {"member": AdminAPIError(500, "boom")}, 502, "Try again in a moment", "kc-moi"),
    ],
)
def test_an_approval_that_fails_decides_nothing(root, application, keycloak, alias, errors, status, detail, keycloak_id):
    keycloak.errors = errors
    response = approve(root, application, alias=alias)
    assert response.status_code == status
    assert detail in str(response.json())
    application.refresh_from_db()
    assert application.status == "pending"
    assert application.keycloak_id == keycloak_id
    assert mail.outbox == []


def test_declining_needs_a_reason_and_emails_it(bob, root, application):
    assert decline(root, application).status_code == 400
    response = decline(root, application, note="Please apply with an official email address.")
    assert response.json()["status"] == "declined"
    [email] = mail.outbox
    assert email.subject == "About your application for Moi University"
    assert "official email address" in email.body
    [mine] = bob.get(reverse("organization-applications")).json()
    assert mine["review_note"] == "Please apply with an official email address."


def test_pending_applications_show_on_the_platform_overview(root, application, carol):
    attention = root.get(reverse("platform-overview")).json()["attention"]
    assert {
        "kind": "application", "title": "1 organisation is waiting to join",
        "detail": "Review their applications.", "link": "/platform/applications",
    } in attention
    baker.make(OrganizationApplication, applicant=carol.profile)
    assert "2 organisations are waiting to join" in str(root.get(reverse("platform-overview")).json()["attention"])


# --- many at once --------------------------------------------------------------------------


def test_approving_many_uses_suggested_aliases_and_reports_each_failure(root, bob, carol, keycloak):
    moi = baker.make(OrganizationApplication, applicant=bob.profile, name="Moi University")
    pydata = baker.make(OrganizationApplication, applicant=carol.profile, name="PyData Nairobi")
    eve = baker.make(OrganizationApplication, applicant=bob.profile, name="Eve Labs")
    keycloak.errors = {"Moi University": AdminAPIError(409, "taken"), "Eve Labs": AdminAPIError(500, "down")}
    body = bulk(root, ids=[moi.id, pydata.id, eve.id], decision="approve").json()
    assert body["done"] == [pydata.id]
    assert body["failed"] == [
        {"id": moi.id, "name": "Moi University", "error": "Its name or alias is taken in Keycloak. Open it to pick another alias."},
        {"id": eve.id, "name": "Eve Labs", "error": "Keycloak could not create the organisation. Try again in a moment."},
    ]
    assert ("create", "PyData Nairobi", "pydata-nairobi") in keycloak.calls
    pydata.refresh_from_db()
    assert pydata.status == "approved"
    assert [m.to for m in mail.outbox] == [["carol@example.com"]]


def test_declining_many_needs_one_reason_for_all(root, bob, carol):
    moi = baker.make(OrganizationApplication, applicant=bob.profile, name="Moi University")
    pydata = baker.make(OrganizationApplication, applicant=carol.profile, name="PyData Nairobi")
    ids = [moi.id, pydata.id]
    assert bulk(root, ids=ids, decision="decline", note="  ").json() == {"note": ["Give a reason. It is emailed to every applicant."]}
    assert bulk(root, ids=ids, decision="decline", note="Not a tech organisation.").json()["done"] == ids
    assert set(OrganizationApplication.objects.values_list("review_note", flat=True)) == {"Not a tech organisation."}
    assert len(mail.outbox) == 2
    # Already decided ones are skipped.
    assert bulk(root, ids=ids, decision="approve").json() == {"done": [], "failed": []}
