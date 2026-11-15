from amt_auth.django.models import Organization
from rest_framework import serializers

from apps.accounts import access
from apps.accounts.serializers import OrganizationSerializer, PersonSerializer
from apps.events.models import Announcement, Event, Feedback, Registration, Resource


class MyRegistrationSerializer(serializers.ModelSerializer):
    has_feedback = serializers.SerializerMethodField()

    class Meta:
        model = Registration
        fields = [
            "id", "status", "ticket_code", "checked_in_at", "certificate_available",
            "has_feedback", "created_at",
        ]

    def get_has_feedback(self, registration) -> bool:
        return hasattr(registration, "feedback")


class EventSerializer(serializers.ModelSerializer):
    organization = OrganizationSerializer(read_only=True)
    organization_id = serializers.CharField(write_only=True)
    registered_count = serializers.IntegerField(read_only=True)
    spots_left = serializers.SerializerMethodField()
    registration_open = serializers.BooleanField(read_only=True)
    can_manage = serializers.SerializerMethodField()
    my_registration = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [
            "id", "organization", "organization_id", "title", "summary", "description",
            "event_type", "delivery_mode", "venue", "online_url", "starts_at", "ends_at",
            "registration_deadline", "capacity", "eligibility", "status", "registered_count",
            "spots_left", "registration_open", "can_manage", "my_registration", "created_at",
        ]
        read_only_fields = ["status", "created_at"]

    def get_spots_left(self, event) -> int | None:
        if event.capacity is None:
            return None
        return max(event.capacity - getattr(event, "registered_count", 0), 0)

    def get_can_manage(self, event) -> bool:
        return event.organization_id in self.context.get("managed_org_ids", ())

    def get_my_registration(self, event):
        registration = self.context.get("my_registrations", {}).get(event.id)
        return MyRegistrationSerializer(registration).data if registration else None

    def to_representation(self, event):
        data = super().to_representation(event)
        # The join link is for people who are coming, and for the organisers.
        registration = self.context.get("my_registrations", {}).get(event.id)
        attending = registration and registration.status == Registration.Status.REGISTERED
        if not (attending or data["can_manage"]):
            data["online_url"] = ""
        return data

    def validate_organization_id(self, value):
        if not Organization.objects.filter(id=value, deleted_at=None).exists():
            raise serializers.ValidationError("Unknown organisation.")
        return value

    def validate(self, attrs):
        starts = attrs.get("starts_at", getattr(self.instance, "starts_at", None))
        ends = attrs.get("ends_at", getattr(self.instance, "ends_at", None))
        deadline = attrs.get(
            "registration_deadline", getattr(self.instance, "registration_deadline", None)
        )
        if starts and ends and ends <= starts:
            raise serializers.ValidationError({"ends_at": "The event must end after it starts."})
        if deadline and ends and deadline > ends:
            raise serializers.ValidationError(
                {"registration_deadline": "Registration must close before the event ends."}
            )
        if self.instance and "organization_id" in attrs:
            if attrs["organization_id"] != self.instance.organization_id:
                raise serializers.ValidationError(
                    {"organization_id": "An event cannot move to another organisation."}
                )
        return attrs


class RegistrationSerializer(serializers.ModelSerializer):
    """A registration as the organisers see it."""

    person = PersonSerializer(source="profile", read_only=True)
    email = serializers.EmailField(source="profile.email", read_only=True)

    class Meta:
        model = Registration
        fields = ["id", "person", "email", "status", "checked_in_at", "created_at"]


class AnnouncementSerializer(serializers.ModelSerializer):
    class Meta:
        model = Announcement
        fields = ["id", "title", "body", "created_at"]


class ResourceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Resource
        fields = ["id", "title", "url", "description", "created_at"]


class FeedbackSerializer(serializers.ModelSerializer):
    rating = serializers.IntegerField(min_value=1, max_value=5)

    class Meta:
        model = Feedback
        fields = ["id", "rating", "comment", "created_at"]


class CheckInSerializer(serializers.Serializer):
    ticket_code = serializers.UUIDField(required=False)
    registration = serializers.IntegerField(required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Send a ticket code or a registration.")
        return attrs


class TransitionSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Event.Status.choices)


def event_context(request, events) -> dict:
    """Per-request lookups the EventSerializer needs, fetched once for a list of events."""
    context = {"managed_org_ids": set(), "my_registrations": {}}
    profile = access.profile_of(request)
    if profile is None:
        return context
    if access.is_platform_admin(request):
        context["managed_org_ids"] = {e.organization_id for e in events}
    else:
        context["managed_org_ids"] = access.managed_org_ids(request, access.Role.EVENT_ORGANISER)
    registrations = Registration.objects.filter(
        profile=profile, event__in=[e.id for e in events]
    ).select_related("event", "feedback")
    context["my_registrations"] = {r.event_id: r for r in registrations}
    return context
