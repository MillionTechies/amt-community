from datetime import timedelta

import pytest
from amt_auth.django.models import Group, Membership
from django.core import mail
from django.utils import timezone

from apps.events.models import Event
from apps.notifications.models import OutboundEmail
from tests.conftest import sign_in
from tests.test_events import create_event
from tests.test_hackathons import create_hackathon


@pytest.fixture
def root():
    return sign_in("root", platform_admin=True)


def make_admin_membership(org, sub):
    group, _ = Group.objects.get_or_create(
        id=f"{org.id}-admins", defaults={"name": "admins", "path": "/admins", "organization": org, "synced_at": timezone.now()}
    )
    Membership.objects.create(user_sub=sub, organization=org, group=group, synced_at=timezone.now())


def test_only_platform_admins(admin, bob):
    for client in (admin, bob):
        for path in ("overview", "organizations", "members", "emails"):
            assert client.get(f"/api/platform/{path}/").status_code == 403


def test_overview_counts_the_whole_community(root, admin, bob, org, other_org):
    make_admin_membership(org, "sub-alice")
    event = create_event(admin, org)
    bob.post(f"/api/events/{event['slug']}/register/")
    create_hackathon(admin, org)
    data = root.get("/api/platform/overview/").json()
    totals = data["totals"]
    assert totals["organizations"] == 2 and totals["events"] == 1 and totals["hackathons"] == 1
    assert totals["registrations"] == 1 and totals["upcoming_events"] == 1
    assert data["events_by_status"] == {"published": 1}
    assert len(data["registrations_30d"]) == 1
    titles = [a["title"] for a in data["attention"]]
    assert "UON has no admin" in titles and "JKUAT has no admin" not in titles


def test_organisations_and_their_detail(root, admin, bob, org, other_org):
    make_admin_membership(org, "sub-alice")
    event = create_event(admin, org)
    bob.post(f"/api/events/{event['slug']}/register/")
    rows = {r["alias"]: r for r in root.get("/api/platform/organizations/").json()}
    assert rows["jkuat"]["admins"] == 1 and rows["jkuat"]["events"] == 1 and rows["jkuat"]["registrations"] == 1
    assert rows["uon"]["events"] == 0

    root.put(f"/api/configuration/{org.id}/", {"values": {"email.from_name": "JKUAT Club"}}, format="json")
    detail = root.get(f"/api/platform/organizations/{org.id}/").json()
    assert detail["admin_people"][0]["name"] == "Alice"
    assert detail["event_list"][0]["registered"] == 1
    assert detail["overrides"] == [{"group": "Email", "keys": ["Sender name"]}]


def test_members_list(root, admin, bob, org):
    event = create_event(admin, org)
    bob.post(f"/api/events/{event['slug']}/register/")
    members = {m["email"]: m for m in root.get("/api/platform/members/").json()}
    assert members["bob@example.com"]["registrations"] == 1 and members["bob@example.com"]["attended"] == 0


def test_failed_emails_can_be_retried(root, admin, bob, org):
    event = create_event(admin, org)
    bob.post(f"/api/events/{event['slug']}/register/")
    OutboundEmail.objects.update(status=OutboundEmail.Status.FAILED, attempts=5, last_error="refused")
    mail.outbox.clear()
    listed = root.get("/api/platform/emails/").json()
    assert listed[0]["status"] == "failed" and listed[0]["last_error"] == "refused"
    assert root.post("/api/platform/emails/", {"failed": True}, format="json").json() == {"retried": 1}
    assert OutboundEmail.objects.get().status == OutboundEmail.Status.SENT and len(mail.outbox) == 1


def test_overview_flags_what_needs_attention(root, admin, bob, carol, org, settings):
    settings.EMAIL_HOST = ""
    settings.GOOGLE_OAUTH_CLIENT_ID = ""
    settings.MICROSOFT_OAUTH_CLIENT_ID = ""
    settings.ZOOM_OAUTH_CLIENT_ID = ""
    make_admin_membership(org, "sub-alice")
    finished = create_event(admin, org)
    bob.post(f"/api/events/{finished['slug']}/register/")
    carol.post(f"/api/events/{finished['slug']}/register/")
    Event.objects.filter(slug=finished["slug"]).update(
        starts_at=timezone.now() - timedelta(days=2), ends_at=timezone.now() - timedelta(days=1)
    )
    OutboundEmail.objects.update(status=OutboundEmail.Status.FAILED)
    titles = [a["title"] for a in root.get("/api/platform/overview/").json()["attention"]]
    assert titles == [
        "2 emails could not be sent",
        "1 finished event is not marked completed",
        "Email is not set up",
        "Google, Microsoft, Zoom not set up",
    ]

    OutboundEmail.objects.exclude(pk=OutboundEmail.objects.first().pk).delete()
    create_event(admin, org, title="Also over")
    Event.objects.update(ends_at=timezone.now() - timedelta(hours=1))
    titles = [a["title"] for a in root.get("/api/platform/overview/").json()["attention"]]
    assert titles[:2] == ["1 email could not be sent", "2 finished events are not marked completed"]


def test_overview_is_quiet_when_all_is_well(root, org, settings):
    make_admin_membership(org, "sub-alice")
    settings.EMAIL_HOST = "smtp.example.com"
    for name in ("GOOGLE", "MICROSOFT", "ZOOM"):
        setattr(settings, f"{name}_OAUTH_CLIENT_ID", f"{name.lower()}-client")
        setattr(settings, f"{name}_OAUTH_CLIENT_SECRET", "secret")
    assert root.get("/api/platform/overview/").json()["attention"] == []


def test_members_list_shows_organisations_and_roles(root, admin, bob, org, other_org):
    make_admin_membership(org, "sub-alice")
    member_group = Group.objects.create(
        id=f"{other_org.id}-members", name="members", path="/members", organization=other_org, synced_at=timezone.now()
    )
    Membership.objects.create(user_sub="sub-alice", organization=other_org, group=member_group, synced_at=timezone.now())
    admin.post(f"/api/organizations/{org.id}/roles/", {"email": "bob@example.com", "role": "event_organiser"}, format="json")
    members = {m["email"]: m for m in root.get("/api/platform/members/").json()}
    assert members["alice@example.com"]["organizations"] == [
        {"name": "JKUAT", "admin": True}, {"name": "UON", "admin": False},
    ]
    assert members["bob@example.com"]["roles"] == ["event organiser at JKUAT"]
    assert members["bob@example.com"]["organizations"] == []


def test_chosen_failed_emails_can_be_retried(root, admin, bob, carol, org):
    event = create_event(admin, org)
    bob.post(f"/api/events/{event['slug']}/register/")
    carol.post(f"/api/events/{event['slug']}/register/")
    OutboundEmail.objects.update(status=OutboundEmail.Status.FAILED, attempts=5)
    mail.outbox.clear()
    to_bob = OutboundEmail.objects.get(to="bob@example.com")
    assert root.post("/api/platform/emails/", {"ids": [to_bob.id]}, format="json").json() == {"retried": 1}
    assert [m.to for m in mail.outbox] == [["bob@example.com"]]
    assert OutboundEmail.objects.get(to="carol@example.com").status == OutboundEmail.Status.FAILED
    assert root.post("/api/platform/emails/", {}, format="json").json() == {"retried": 0}
