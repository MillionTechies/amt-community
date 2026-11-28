"""Taking part in a hackathon: registering, then finding a team.

Registering makes someone a participant. Their team comes later: they start one, join an
open one, enter a team's code, or (with invitations) accept a leader's invite. The rules
live here so every way in, from the hackathon page to the 6-digit code, checks the same.
"""

from django.db import IntegrityError, transaction
from rest_framework.exceptions import ValidationError

from apps.hackathons.models import Hackathon, Participant, Team, TeamMember


def register(hackathon, profile, *, invited=False) -> Participant:
    """Register `profile`, or return their registration. Invited people may come after the deadline."""
    is_open = hackathon.status == Hackathon.Status.PUBLISHED if invited else hackathon.registration_open
    if not is_open:
        raise ValidationError("Registration for this hackathon is closed.")
    if hackathon.judges.filter(profile=profile).exists():
        raise ValidationError("Judges cannot take part in the hackathon they judge.")
    return Participant.objects.get_or_create(hackathon=hackathon, profile=profile)[0]


def _require_teamless(hackathon, profile) -> None:
    if hackathon.team_members.filter(profile=profile).exists():
        raise ValidationError("You are already in a team for this hackathon.")


def create_team(hackathon, profile, name) -> Team:
    """Register `profile` if needed and make them the leader of a new team."""
    try:
        with transaction.atomic():
            register(hackathon, profile)
            _require_teamless(hackathon, profile)
            team = Team.objects.create(hackathon=hackathon, name=name)
            TeamMember.objects.create(team=team, hackathon=hackathon, profile=profile, is_leader=True)
    except IntegrityError as exc:
        raise ValidationError({"name": "A team with this name already exists."}) from exc
    return team


def join(team, profile, *, invited=False) -> TeamMember:
    """Register `profile` if needed and add them to `team`, while it has room."""
    hackathon = team.hackathon
    with transaction.atomic():
        register(hackathon, profile, invited=invited)
        _require_teamless(hackathon, profile)
        locked = Team.objects.select_for_update().get(pk=team.pk)
        if locked.members.count() >= hackathon.max_team_size:
            raise ValidationError("This team is full.")
        return TeamMember.objects.create(team=team, hackathon=hackathon, profile=profile)


def join_by_code(code, profile) -> tuple[Hackathon, Team | None]:
    """A hackathon's code registers you; a team's code also puts you in that team."""
    hackathon = Hackathon.objects.filter(join_code=code).first()
    team = Team.objects.select_related("hackathon").filter(invite_code=code).first()
    if hackathon:
        register(hackathon, profile)
    elif team:
        join(team, profile)
        hackathon = team.hackathon
    else:
        raise ValidationError({"code": "No hackathon or team has this code."})
    return hackathon, team
