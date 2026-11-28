from amt_auth.django.models import Organization
from rest_framework import serializers

from apps.accounts.models import OrganizationApplication, Position, Profile, RoleAssignment


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = [
            "sub", "email", "full_name", "headline", "bio", "institution",
            "skills", "github_url", "linkedin_url", "created_at",
        ]
        read_only_fields = ["sub", "email", "full_name", "created_at"]

    def validate_skills(self, value):
        if not isinstance(value, list) or not all(isinstance(s, str) for s in value):
            raise serializers.ValidationError("Skills must be a list of words.")
        return [s.strip() for s in value if s.strip()][:30]


class PersonSerializer(serializers.ModelSerializer):
    """How one member appears to another."""

    name = serializers.CharField(source="display_name")

    class Meta:
        model = Profile
        fields = ["sub", "name", "headline", "institution"]


class TeammateSerializer(PersonSerializer):
    """A member as other hackers see them: enough to pick a teammate."""

    class Meta(PersonSerializer.Meta):
        fields = PersonSerializer.Meta.fields + ["skills", "github_url", "linkedin_url"]


class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = ["id", "name", "alias"]


class RoleAssignmentSerializer(serializers.ModelSerializer):
    person = PersonSerializer(source="profile", read_only=True)
    email = serializers.EmailField(source="profile.email", read_only=True)

    class Meta:
        model = RoleAssignment
        fields = ["id", "role", "person", "email", "created_at"]


class GrantRoleSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role = serializers.ChoiceField(choices=RoleAssignment.Role.choices)


class PositionSerializer(serializers.ModelSerializer):
    """A position as its organization's admins manage it."""

    holder = PersonSerializer(read_only=True)
    holder_email = serializers.EmailField(source="holder.email", read_only=True, default=None)
    invitation = serializers.SerializerMethodField()

    class Meta:
        model = Position
        fields = ["id", "title", "order", "roles", "is_public", "holder", "holder_email", "invitation"]

    def validate_roles(self, value):
        known = set(RoleAssignment.Role.values)
        if not isinstance(value, list) or not set(value) <= known:
            raise serializers.ValidationError("Choose roles from event organiser and hackathon manager.")
        return list(dict.fromkeys(value))

    def get_invitation(self, position) -> dict | None:
        """The invitation waiting for an answer, if someone has been asked to take it."""
        pending = getattr(position, "pending_invitations", [])
        return {"id": pending[0].id, "name": pending[0].invitee_name, "created_at": pending[0].created_at} if pending else None


class LeaderSerializer(serializers.ModelSerializer):
    """A filled public position, on the organization's page."""

    person = PersonSerializer(source="holder", read_only=True)

    class Meta:
        model = Position
        fields = ["id", "title", "person"]


class OrganizationApplicationSerializer(serializers.ModelSerializer):
    """An application as its applicant sees it, and the form they send."""

    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    organization_id = serializers.CharField(source="keycloak_id", read_only=True)

    class Meta:
        model = OrganizationApplication
        fields = [
            "id", "name", "kind", "kind_label", "website", "location", "about", "plans",
            "contact_phone", "status", "review_note", "organization_id", "created_at", "reviewed_at",
        ]
        read_only_fields = ["status", "review_note", "created_at", "reviewed_at"]

    def validate_name(self, value):
        name = value.strip()
        if Organization.objects.filter(name__iexact=name, deleted_at=None).exists():
            raise serializers.ValidationError(
                f"{name} is already on Community. Ask its admins to add you, or give us your own organisation's name."
            )
        pending = OrganizationApplication.objects.filter(
            applicant=self.context["applicant"], name__iexact=name,
            status=OrganizationApplication.Status.PENDING,
        )
        if pending.exists():
            raise serializers.ValidationError(f"You already applied for {name}. We will email you once it is reviewed.")
        return name


# How many faces a card shows: "AM", "JK", "WN" and 166 more.
PREVIEW_SIZE = 3


def initials(full_name: str) -> str:
    """'Alice Wanjiku Kamau' -> 'AK'. Lists show initials rather than names."""
    first, *rest = (full_name or "?").split() or ["?"]
    return (first[0] + "".join(rest[-1:])[:1]).upper()
