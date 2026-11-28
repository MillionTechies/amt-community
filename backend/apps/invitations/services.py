"""Inviting people by email, and what accepting does for each kind of invitation."""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts import access
from apps.accounts.models import RoleAssignment
from apps.hackathons import participation
from apps.hackathons.models import Judge, Participant, TeamMember
from apps.invitations.models import Invitation
from apps.notifications import emails

Kind = Invitation.Kind


# --- refusing what the person already has --------------------------------------------


def _org_role_taken(email, target):
    if RoleAssignment.objects.filter(
        profile__email__iexact=email, organization=target["organization"], role=target["role"]
    ).exists():
        raise ValidationError({"email": "They already have this role."})


def _hackathon_taken(email, hackathon):
    if Judge.objects.filter(hackathon=hackathon, profile__email__iexact=email).exists():
        raise ValidationError({"email": "They judge this hackathon."})
    if Participant.objects.filter(hackathon=hackathon, profile__email__iexact=email).exists():
        raise ValidationError({"email": "They take part in this hackathon."})


def _team_taken(email, target):
    team = target["team"]
    hackathon = team.hackathon
    if TeamMember.objects.filter(hackathon=hackathon, profile__email__iexact=email).exists():
        raise ValidationError({"email": "They are already in a team for this hackathon."})
    if Judge.objects.filter(hackathon=hackathon, profile__email__iexact=email).exists():
        raise ValidationError({"email": "They judge this hackathon."})
    waiting = team.invitations.filter(status=Invitation.Status.PENDING).exclude(email=email).count()
    if team.members.count() + waiting >= hackathon.max_team_size:
        raise ValidationError({"email": "Your team is full, counting the invitations already sent."})


TAKEN = {
    Kind.ORG_ROLE: _org_role_taken,
    Kind.JUDGE: lambda email, target: _hackathon_taken(email, target["hackathon"]),
    Kind.PARTICIPANT: lambda email, target: _hackathon_taken(email, target["hackathon"]),
    Kind.TEAM: _team_taken,
}


def invite(kind, email, invited_by, *, profile=None, **target) -> Invitation:
    """Invite `email`, or send the pending invitation for the same thing again.

    `target` names what it is for: organization and role, hackathon, or team (and its
    hackathon). Refused when the person already has it.
    """
    email = email.strip().lower()
    TAKEN[kind](email, target)
    invitation, _ = Invitation.objects.get_or_create(
        kind=kind, email=email, status=Invitation.Status.PENDING, **target,
        defaults={"invited_by": invited_by, "profile": profile},
    )
    send(invitation)
    return invitation


def send(invitation) -> None:
    invitation.sent_count += 1
    invitation.save(update_fields=["sent_count"])
    emails.invitation(invitation)


# --- accepting ------------------------------------------------------------------------


def _accept_org_role(invitation, profile):
    RoleAssignment.objects.get_or_create(
        profile=profile, organization=invitation.organization, role=invitation.role,
        defaults={"granted_by": invitation.invited_by},
    )


def _accept_judge(invitation, profile):
    if invitation.hackathon.participants.filter(profile=profile).exists():
        raise ValidationError("You take part in this hackathon, so you cannot judge it.")
    Judge.objects.get_or_create(hackathon=invitation.hackathon, profile=profile)


ACCEPT = {
    Kind.ORG_ROLE: _accept_org_role,
    Kind.JUDGE: _accept_judge,
    Kind.PARTICIPANT: lambda invitation, profile: participation.register(invitation.hackathon, profile, invited=True),
    Kind.TEAM: lambda invitation, profile: participation.join(invitation.team, profile, invited=True),
}

CLOSED = {
    Invitation.Status.ACCEPTED: "This invitation has already been accepted.",
    Invitation.Status.DECLINED: "This invitation was declined.",
    Invitation.Status.REVOKED: "This invitation was withdrawn.",
}


def _respond(invitation, status, profile=None):
    if invitation.status != Invitation.Status.PENDING:
        raise ValidationError(CLOSED[invitation.status])
    invitation.status = status
    invitation.accepted_by = profile
    invitation.responded_at = timezone.now()
    invitation.save(update_fields=["status", "accepted_by", "responded_at"])


def accept(invitation, profile) -> None:
    with transaction.atomic():
        _respond(invitation, Invitation.Status.ACCEPTED, profile)
        ACCEPT[invitation.kind](invitation, profile)


def decline(invitation) -> None:
    _respond(invitation, Invitation.Status.DECLINED)


def revoke(invitation) -> None:
    _respond(invitation, Invitation.Status.REVOKED)


# --- who may resend or withdraw ---------------------------------------------------------


def can_administer(request, invitation) -> bool:
    if invitation.kind == Kind.ORG_ROLE:
        return access.is_org_admin(request, invitation.organization_id)
    if invitation.kind == Kind.TEAM:
        return invitation.team.members.filter(profile=access.profile_of(request), is_leader=True).exists()
    return access.can_manage(request, invitation.hackathon.organization_id, access.Role.HACKATHON_MANAGER)
