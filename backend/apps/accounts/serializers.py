from amt_auth.django.models import Organization
from rest_framework import serializers

from apps.accounts.models import Profile, RoleAssignment


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


# How many faces a card shows: "AM", "JK", "WN" and 166 more.
PREVIEW_SIZE = 3


def initials(full_name: str) -> str:
    """'Alice Wanjiku Kamau' -> 'AK'. Lists show initials rather than names."""
    first, *rest = (full_name or "?").split() or ["?"]
    return (first[0] + "".join(rest[-1:])[:1]).upper()
