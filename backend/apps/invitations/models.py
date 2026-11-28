import secrets

from django.db import models

from apps.accounts.models import Profile, RoleAssignment


def new_token() -> str:
    return secrets.token_urlsafe(24)


def mask(email: str) -> str:
    """'wanjiru@example.com' -> 'w***@example.com': enough to recognise, not enough to harvest."""
    name, _, domain = email.partition("@")
    return f"{name[:1]}***@{domain}"


def a_or_an(noun: str) -> str:
    return f"{'an' if noun[:1] in 'aeiou' else 'a'} {noun}"


class Invitation(models.Model):
    """An emailed invitation to a role, a hackathon or a team, for anyone with an email address.

    The person may not have an account yet: the email takes them to the invitation, they
    sign up (or in) with that address, then accept. Nothing is granted until they do.
    """

    class Kind(models.TextChoices):
        ORG_ROLE = "org_role", "Organisation role"
        POSITION = "position", "Position"
        JUDGE = "judge", "Judge"
        PARTICIPANT = "participant", "Participant"
        TEAM = "team", "Team member"

    class Status(models.TextChoices):
        PENDING = "pending", "Waiting for an answer"
        ACCEPTED = "accepted", "Accepted"
        DECLINED = "declined", "Declined"
        REVOKED = "revoked", "Withdrawn"

    kind = models.CharField(max_length=20, choices=Kind.choices)
    # Always lower case; accepting needs an account with this address.
    email = models.EmailField(db_index=True)
    # Set when the inviter picked a member (a team leader from the looking-for-team list),
    # so their name shows without revealing their email.
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, null=True, blank=True, related_name="+")
    token = models.CharField(max_length=64, unique=True, default=new_token)
    organization = models.ForeignKey(
        "amt_auth.Organization", on_delete=models.CASCADE, null=True, blank=True, related_name="invitations"
    )
    role = models.CharField(max_length=32, choices=RoleAssignment.Role.choices, blank=True)
    position = models.ForeignKey(
        "accounts.Position", on_delete=models.CASCADE, null=True, blank=True, related_name="invitations"
    )
    hackathon = models.ForeignKey(
        "hackathons.Hackathon", on_delete=models.CASCADE, null=True, blank=True, related_name="invitations"
    )
    team = models.ForeignKey(
        "hackathons.Team", on_delete=models.CASCADE, null=True, blank=True, related_name="invitations"
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    invited_by = models.ForeignKey(Profile, on_delete=models.SET_NULL, null=True, related_name="invitations_sent")
    accepted_by = models.ForeignKey(Profile, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    sent_count = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    responded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.email}: {self.summary} ({self.get_status_display()})"

    @property
    def summary(self) -> str:
        """What accepting does, to finish "You are invited to …"."""
        if self.kind == self.Kind.ORG_ROLE:
            return f"be {a_or_an(self.get_role_display().lower())} at {self.organization.name}"
        if self.kind == self.Kind.POSITION:
            return f"be {self.position.title} of {self.organization.name}"
        if self.kind == self.Kind.JUDGE:
            return f"judge {self.hackathon.title}"
        if self.kind == self.Kind.PARTICIPANT:
            return f"take part in {self.hackathon.title}"
        return f"join {self.team.name} at {self.hackathon.title}"

    @property
    def invitee_name(self) -> str:
        return self.profile.display_name if self.profile else self.email
