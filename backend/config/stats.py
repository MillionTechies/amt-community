"""Community-wide numbers for the landing page. Public: counts only, no personal data."""

from rest_framework import permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.accounts.models import Profile
from apps.events.models import Event, Registration
from apps.hackathons.models import Hackathon, Submission

# Drafts and cancellations never happened as far as the public is concerned.
HELD_EVENTS = [Event.Status.PUBLISHED, Event.Status.COMPLETED]
HELD_HACKATHONS = [Hackathon.Status.PUBLISHED, Hackathon.Status.JUDGING, Hackathon.Status.COMPLETED]


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def community_stats(request):
    events = Event.objects.filter(status__in=HELD_EVENTS)
    hackathons = Hackathon.objects.filter(status__in=HELD_HACKATHONS)
    organizations = set(events.values_list("organization_id", flat=True)) | set(
        hackathons.values_list("organization_id", flat=True)
    )
    return Response(
        {
            "members": Profile.objects.count(),
            "events": events.count(),
            "check_ins": Registration.objects.filter(
                event__in=events, checked_in_at__isnull=False
            ).count(),
            "hackathons": hackathons.count(),
            "projects": Submission.objects.filter(team__hackathon__in=hackathons).count(),
            "organizations": len(organizations),
        }
    )
