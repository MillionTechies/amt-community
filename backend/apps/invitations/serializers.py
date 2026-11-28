from rest_framework import serializers

from apps.invitations.models import Invitation, mask


class InvitationSerializer(serializers.ModelSerializer):
    """An invitation as the people who sent it see it."""

    name = serializers.CharField(source="invitee_name", read_only=True)

    class Meta:
        model = Invitation
        fields = ["id", "kind", "email", "name", "role", "status", "sent_count", "created_at"]


class TeamInvitationSerializer(serializers.ModelSerializer):
    """A team's pending invitation, as its members see it: a member's name, never their email."""

    name = serializers.CharField(source="invitee_name", read_only=True)

    class Meta:
        model = Invitation
        fields = ["id", "name", "created_at"]


class PublicInvitationSerializer(serializers.ModelSerializer):
    """What the link in the email shows, to whoever opens it."""

    email_hint = serializers.SerializerMethodField()
    summary = serializers.CharField(read_only=True)
    invited_by = serializers.SerializerMethodField()
    organization = serializers.CharField(source="organization.name", default=None)
    hackathon = serializers.SerializerMethodField()
    team = serializers.CharField(source="team.name", default=None)
    is_for_you = serializers.SerializerMethodField()

    class Meta:
        model = Invitation
        fields = [
            "token", "kind", "status", "email_hint", "summary", "invited_by", "organization", "role",
            "hackathon", "team", "is_for_you", "created_at",
        ]

    def get_email_hint(self, invitation) -> str:
        return mask(invitation.email)

    def get_invited_by(self, invitation) -> str:
        return invitation.invited_by.display_name if invitation.invited_by else "Someone"

    def get_hackathon(self, invitation) -> dict | None:
        h = invitation.hackathon
        return {"slug": h.slug, "title": h.title} if h else None

    def get_is_for_you(self, invitation) -> bool:
        email = getattr(self.context.get("profile"), "email", "")
        return email.lower() == invitation.email


class InviteSerializer(serializers.Serializer):
    email = serializers.EmailField()


class BulkInviteSerializer(serializers.Serializer):
    """Hackathon managers invite judges or participants, many at once."""

    kind = serializers.ChoiceField(choices=[Invitation.Kind.JUDGE, Invitation.Kind.PARTICIPANT])
    emails = serializers.ListField(child=serializers.EmailField(), min_length=1, max_length=200)
