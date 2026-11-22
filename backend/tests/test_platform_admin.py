from datetime import timedelta

import pytest
from amt_auth.django.models import Group, Membership
from django.core import mail
from django.urls import reverse
from django.utils import timezone
from model_bakery import baker

from apps.accounts.models import RoleAssignment
from apps.configuration.models import Setting
from apps.events.models import Event, Registration
from apps.hackathons.models import Hackathon
from apps.notifications.models import OutboundEmail
from tests.conftest import sign_in


@pytest.fixture
def root():
    return sign_in("root", platform_admin=True)


@pytest.fixture
def alice_admins_org(admin, org):
    """Alice is in JKUAT's admins group in the Keycloak mirror, as well as in her token."""
    admins = baker.make(Group, id=f"{org.id}-admins", name="admins", path="/admins", organization=org)
    baker.make(Membership, user_sub="sub-alice", organization=org, group=admins)


@pytest.fixture
def event(org):
    return baker.make(
        Event, organization=org, status=Event.Status.PUBLISHED,
        starts_at=timezone.now() + timedelta(days=7), ends_at=timezone.now() + timedelta(days=7, hours=2),
    )


def test_only_platform_admins_see_the_platform(admin, org):
    # Not even an organisation's own admin.
    assert admin.get(reverse("platform-overview")).status_code == 403
    assert admin.get(reverse("platform-organizations")).status_code == 403
    assert admin.get(reverse("platform-organization", kwargs={"organization_id": org.id})).status_code == 403
    assert admin.get(reverse("platform-members")).status_code == 403
    assert admin.get(reverse("platform-emails")).status_code == 403


def test_overview_counts_the_whole_community(root, bob, org, other_org, alice_admins_org, event):
    baker.make(Registration, event=event, profile=bob.profile)
    baker.make(Hackathon, organization=org)
    data = root.get(reverse("platform-overview")).json()
    assert data["totals"]["organizations"] == 2
    assert data["totals"]["events"] == 1
    assert data["totals"]["upcoming_events"] == 1
    assert data["totals"]["hackathons"] == 1
    assert data["totals"]["registrations"] == 1
    assert data["events_by_status"] == {"published": 1}
    assert len(data["registrations_30d"]) == 1
    titles = [a["title"] for a in data["attention"]]
    assert "UON has no admin" in titles
    assert "JKUAT has no admin" not in titles


def test_overview_flags_what_needs_attention(root, org, alice_admins_org, settings):
    settings.EMAIL_HOST = ""
    settings.GOOGLE_OAUTH_CLIENT_ID = ""
    settings.MICROSOFT_OAUTH_CLIENT_ID = ""
    settings.ZOOM_OAUTH_CLIENT_ID = ""
    baker.make(OutboundEmail, status=OutboundEmail.Status.FAILED, _quantity=2)
    baker.make(Event, organization=org, status=Event.Status.PUBLISHED, ends_at=timezone.now() - timedelta(days=1))
    titles = [a["title"] for a in root.get(reverse("platform-overview")).json()["attention"]]
    assert titles == [
        "2 emails could not be sent",
        "1 finished event is not marked completed",
        "Email is not set up",
        "Google, Microsoft, Zoom not set up",
    ]


def test_overview_is_quiet_when_all_is_well(root, alice_admins_org, settings):
    settings.EMAIL_HOST = "smtp.example.com"
    settings.GOOGLE_OAUTH_CLIENT_ID = settings.MICROSOFT_OAUTH_CLIENT_ID = settings.ZOOM_OAUTH_CLIENT_ID = "client"
    settings.GOOGLE_OAUTH_CLIENT_SECRET = settings.MICROSOFT_OAUTH_CLIENT_SECRET = settings.ZOOM_OAUTH_CLIENT_SECRET = "secret"
    assert root.get(reverse("platform-overview")).json()["attention"] == []


def test_organisations_and_their_detail(root, bob, org, other_org, alice_admins_org, event):
    baker.make(Registration, event=event, profile=bob.profile)
    baker.make(Setting, organization=org, key="email.from_name", value="JKUAT Club")
    rows = root.get(reverse("platform-organizations")).json()
    assert [(r["alias"], r["admins"], r["events"], r["registrations"]) for r in rows] == [("jkuat", 1, 1, 1), ("uon", 0, 0, 0)]

    detail = root.get(reverse("platform-organization", kwargs={"organization_id": org.id})).json()
    assert detail["admin_people"] == [{"sub": "sub-alice", "name": "Alice", "email": "alice@example.com"}]
    assert detail["event_list"][0]["registered"] == 1
    assert detail["overrides"] == [{"group": "Email", "keys": ["Sender name"]}]


def test_members_show_their_organisations_roles_and_registrations(root, bob, org, other_org, alice_admins_org, event):
    baker.make(Membership, user_sub="sub-alice", organization=other_org)
    baker.make(RoleAssignment, profile=bob.profile, organization=org, role=RoleAssignment.Role.EVENT_ORGANISER)
    baker.make(Registration, event=event, profile=bob.profile)
    members = {m["email"]: m for m in root.get(reverse("platform-members")).json()}
    assert members["alice@example.com"]["organizations"] == [{"name": "JKUAT", "admin": True}, {"name": "UON", "admin": False}]
    assert members["bob@example.com"]["organizations"] == []
    assert members["bob@example.com"]["roles"] == ["event organiser at JKUAT"]
    assert (members["bob@example.com"]["registrations"], members["bob@example.com"]["attended"]) == (1, 0)


def test_failed_emails_can_be_retried_all_or_chosen(root):
    to_bob = baker.make(OutboundEmail, to="bob@example.com", status=OutboundEmail.Status.FAILED, attempts=5, last_error="refused")
    baker.make(OutboundEmail, to="carol@example.com", status=OutboundEmail.Status.FAILED, attempts=5)
    listed = root.get(reverse("platform-emails")).json()
    assert [(e["to"], e["status"], e["last_error"], e["event"]) for e in listed] == [
        ("carol@example.com", "failed", "", ""), ("bob@example.com", "failed", "refused", ""),
    ]

    assert root.post(reverse("platform-emails"), {"ids": [to_bob.id]}, format="json").json() == {"retried": 1}
    assert [m.to for m in mail.outbox] == [["bob@example.com"]]
    assert root.post(reverse("platform-emails"), {}, format="json").json() == {"retried": 0}
    assert root.post(reverse("platform-emails"), {"failed": True}, format="json").json() == {"retried": 1}
    assert set(OutboundEmail.objects.values_list("status", flat=True)) == {OutboundEmail.Status.SENT}
