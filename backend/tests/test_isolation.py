"""An organisation's admins and organisers see only their own organisation's management data."""

import pytest
from django.urls import reverse
from model_bakery import baker

from apps.events.models import Event
from apps.hackathons.models import Hackathon
from tests.conftest import sign_in


@pytest.fixture
def theirs(other_org):
    """UoN runs a published event and hackathon, plus drafts of each."""
    return {
        "event": baker.make(Event, organization=other_org, status=Event.Status.PUBLISHED).slug,
        "draft_event": baker.make(Event, organization=other_org, title="Secret plan").slug,
        "hackathon": baker.make(Hackathon, organization=other_org, status=Hackathon.Status.PUBLISHED).slug,
        "draft_hackathon": baker.make(Hackathon, organization=other_org, title="Secret jam").slug,
        "organization": other_org.id,
    }


@pytest.mark.parametrize(
    "route, key, status_code",
    [
        ("event-registrations", "event", 403),
        ("event-stats", "event", 403),
        ("event-links", "event", 403),
        ("hackathon-judges", "hackathon", 403),
        ("hackathon-teams", "hackathon", 403),
        ("event-detail", "draft_event", 404),
        ("hackathon-detail", "draft_hackathon", 404),
        ("organization-roles", "organization", 403),
    ],
)
def test_another_organisations_admin_is_refused(admin, theirs, route, key, status_code):
    assert admin.get(reverse(route, args=[theirs[key]])).status_code == status_code


@pytest.mark.parametrize("route, model", [("event-list", Event), ("hackathon-list", Hackathon)])
def test_console_lists_show_only_your_organisation(admin, org, theirs, route, model):
    baker.make(model, organization=org, status="published")
    managed = admin.get(f"{reverse(route)}?scope=managed").json()
    assert managed["count"] == 1
    assert managed["results"][0]["organization"]["id"] == org.id


def test_me_lists_only_your_organisations(admin, org, theirs):
    organizations = admin.get(reverse("me")).json()["organizations"]
    assert len(organizations) == 1
    assert organizations[0]["id"] == org.id


def test_platform_admins_do_not_manage_organisations_events(theirs):
    root = sign_in("root", platform_admin=True)
    assert root.get(f"{reverse('event-list')}?scope=managed").json()["count"] == 0
    # They see what any member sees: published events, never a draft.
    listed = root.get(reverse("event-list")).json()["results"]
    assert len(listed) == 1
    assert listed[0]["slug"] == theirs["event"]
    assert listed[0]["can_manage"] is False
    assert root.get(reverse("event-detail", args=[theirs["draft_event"]])).status_code == 404

    published = reverse("event-detail", args=[theirs["event"]])
    assert root.patch(published, {"title": "Mine now"}, format="json").status_code == 403
    announcement = {"title": "Hi", "body": "x"}
    announcements = reverse("event-announcements", args=[theirs["event"]])
    assert root.post(announcements, announcement, format="json").status_code == 403
