from datetime import timedelta

from django.utils import timezone

from apps.accounts.models import Profile
from apps.events.models import Event, Registration
from apps.hackathons.models import Hackathon, Submission, Team


def make_event(org, status):
    now = timezone.now()
    return Event.objects.create(
        organization=org,
        title="Intro to APIs",
        starts_at=now,
        ends_at=now + timedelta(hours=2),
        status=status,
    )


def make_hackathon(org, status):
    now = timezone.now()
    return Hackathon.objects.create(
        organization=org,
        title="Build for Health",
        starts_at=now,
        ends_at=now + timedelta(days=2),
        registration_deadline=now,
        submission_deadline=now + timedelta(days=2),
        status=status,
    )


def test_stats_count_only_what_the_public_can_see(anonymous, org, other_org):
    alice = Profile.objects.create(sub="sub-alice")
    bob = Profile.objects.create(sub="sub-bob")

    held = make_event(org, Event.Status.COMPLETED)
    draft = make_event(other_org, Event.Status.DRAFT)
    Registration.objects.create(event=held, profile=alice, checked_in_at=timezone.now())
    Registration.objects.create(event=held, profile=bob)  # registered, never turned up
    Registration.objects.create(event=draft, profile=bob, checked_in_at=timezone.now())

    running = make_hackathon(org, Hackathon.Status.JUDGING)
    cancelled = make_hackathon(other_org, Hackathon.Status.CANCELLED)
    for hackathon in (running, cancelled):
        team = Team.objects.create(hackathon=hackathon, name="Rhinos")
        Submission.objects.create(
            team=team,
            title="Clinic queue",
            description="Shorter waits.",
            repository_url="https://example.com/r",
        )

    response = anonymous.get("/api/stats/")

    assert response.status_code == 200
    assert response.json() == {
        "members": 2,
        "events": 1,
        "check_ins": 1,
        "hackathons": 1,
        "projects": 1,
        "organizations": 1,
    }
