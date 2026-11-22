from django.urls import reverse
from django.utils import timezone
from model_bakery import baker

from apps.accounts.models import Profile
from apps.events.models import Event, Registration
from apps.hackathons.models import Hackathon, Submission


def test_stats_count_only_what_the_public_can_see(anonymous, org, other_org):
    alice, bob = baker.make(Profile, _quantity=2)
    held = baker.make(Event, organization=org, status=Event.Status.COMPLETED)
    draft = baker.make(Event, organization=other_org, status=Event.Status.DRAFT)
    baker.make(Registration, event=held, profile=alice, checked_in_at=timezone.now())
    baker.make(Registration, event=held, profile=bob)  # registered, never turned up
    baker.make(Registration, event=draft, profile=bob, checked_in_at=timezone.now())
    judging = baker.make(Hackathon, organization=org, status=Hackathon.Status.JUDGING)
    cancelled = baker.make(Hackathon, organization=other_org, status=Hackathon.Status.CANCELLED)
    baker.make(Submission, team__hackathon=judging)
    baker.make(Submission, team__hackathon=cancelled)

    assert anonymous.get(reverse("stats")).json() == {
        "members": 2,
        "events": 1,
        "check_ins": 1,
        "hackathons": 1,
        "projects": 1,
        "organizations": 1,
    }
