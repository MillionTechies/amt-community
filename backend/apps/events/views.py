from django.db import transaction
from django.db.models import Avg, Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.accounts import access
from apps.events.models import Announcement, Event, Feedback, Registration, Resource
from apps.events.serializers import (
    AnnouncementSerializer,
    CheckInSerializer,
    EventSerializer,
    FeedbackSerializer,
    RegistrationSerializer,
    ResourceSerializer,
    TransitionSerializer,
    event_context,
)
from apps.notifications import emails

ROLE = access.Role.EVENT_ORGANISER
PUBLIC_STATUSES = [Event.Status.PUBLISHED, Event.Status.COMPLETED, Event.Status.CANCELLED]
# Which status an event may move to from each status.
TRANSITIONS = {
    Event.Status.DRAFT: {Event.Status.PUBLISHED},
    Event.Status.PUBLISHED: {Event.Status.COMPLETED, Event.Status.CANCELLED},
    Event.Status.COMPLETED: set(),
    Event.Status.CANCELLED: set(),
}


def visible_events(request):
    """Published events for everyone; drafts only for those who manage the organization."""
    events = Event.objects.select_related("organization").annotate(
        registered_count=Count(
            "registrations", filter=Q(registrations__status=Registration.Status.REGISTERED)
        )
    ).order_by("starts_at", "id")
    if access.is_platform_admin(request):
        return events
    return events.filter(
        Q(status__in=PUBLIC_STATUSES)
        | Q(organization_id__in=access.managed_org_ids(request, ROLE))
    )


class EventViewSet(viewsets.ModelViewSet):
    lookup_field = "slug"
    serializer_class = EventSerializer
    filterset_fields = ["organization", "status", "event_type", "delivery_mode"]
    search_fields = ["title", "summary", "description", "venue"]
    ordering_fields = ["starts_at", "created_at"]

    def get_queryset(self):
        events = visible_events(self.request)
        params = self.request.query_params
        now = timezone.now()
        if params.get("when") == "upcoming":
            events = events.filter(ends_at__gte=now)
        elif params.get("when") == "past":
            events = events.filter(ends_at__lt=now).order_by("-starts_at")
        profile = access.profile_of(self.request)
        if params.get("scope") == "mine":
            # Events the member is registered for or waitlisted on.
            mine = Registration.objects.filter(
                profile=profile,
                status__in=[Registration.Status.REGISTERED, Registration.Status.WAITLISTED],
            )
            events = events.filter(id__in=mine.values("event_id")) if profile else events.none()
        elif params.get("scope") == "managed":
            if not access.is_platform_admin(self.request):
                events = events.filter(
                    organization_id__in=access.managed_org_ids(self.request, ROLE)
                )
        return events

    # The serializer needs the member's registrations and managed organizations.
    def get_serializer_context(self):
        return {**super().get_serializer_context(), **getattr(self, "_event_context", {})}

    def _with_context(self, events):
        self._event_context = event_context(self.request, events)

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        self._with_context(page)
        return self.get_paginated_response(self.get_serializer(page, many=True).data)

    def get_object(self):
        event = super().get_object()
        self._with_context([event])
        return event

    def _manageable(self):
        event = self.get_object()
        access.require_manage(self.request, event.organization_id, ROLE)
        return event

    def perform_create(self, serializer):
        organization_id = serializer.validated_data["organization_id"]
        access.require_manage(self.request, organization_id, ROLE)
        event = serializer.save(created_by=access.profile_of(self.request))
        event.registered_count = 0
        self._with_context([event])
        serializer.context.update(self._event_context)

    def perform_update(self, serializer):
        access.require_manage(self.request, serializer.instance.organization_id, ROLE)
        before = emails.snapshot(serializer.instance)
        event = serializer.save()
        emails.event_changed(event, before)

    def perform_destroy(self, event):
        access.require_manage(self.request, event.organization_id, ROLE)
        if event.status != Event.Status.DRAFT:
            raise ValidationError("Only drafts can be deleted. Cancel a published event instead.")
        event.delete()

    @action(detail=True, methods=["post"])
    def transition(self, request, slug=None):
        """Publish, complete or cancel the event."""
        event = self._manageable()
        data = TransitionSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        target = data.validated_data["status"]
        if target not in TRANSITIONS[event.status]:
            raise ValidationError(
                f"A {event.get_status_display().lower()} event cannot become {target}."
            )
        event.status = target
        event.save(update_fields=["status", "updated_at"])
        if target == Event.Status.CANCELLED:
            emails.event_cancelled(event)
        return Response(self.get_serializer(event).data)

    @action(detail=True, methods=["post", "delete"], permission_classes=[permissions.IsAuthenticated])
    def register(self, request, slug=None):
        """POST registers the member (or waitlists them when full); DELETE cancels."""
        profile = access.profile_of(request)
        with transaction.atomic():
            # Lock the event so two people cannot take the last place.
            event = get_object_or_404(
                Event.objects.select_for_update(), pk=self.get_object().pk
            )
            active = event.registrations.filter(status=Registration.Status.REGISTERED)
            if request.method == "POST":
                if not event.registration_open:
                    raise ValidationError("Registration for this event is closed.")
                registration = event.registrations.filter(profile=profile).first()
                if registration and registration.status != Registration.Status.CANCELLED:
                    raise ValidationError("You are already registered for this event.")
                full = event.capacity is not None and active.count() >= event.capacity
                new_status = (
                    Registration.Status.WAITLISTED if full else Registration.Status.REGISTERED
                )
                if registration:
                    registration.status = new_status
                    registration.created_at = timezone.now()  # rejoin at the back of the queue
                    registration.save(update_fields=["status", "created_at"])
                else:
                    registration = event.registrations.create(profile=profile, status=new_status)
                emails.registration_changed(registration)
            else:
                registration = event.registrations.filter(profile=profile).first()
                if registration is None or registration.status == Registration.Status.CANCELLED:
                    raise ValidationError("You are not registered for this event.")
                if registration.checked_in_at:
                    raise ValidationError("You have already checked in to this event.")
                freed_place = registration.status == Registration.Status.REGISTERED
                registration.status = Registration.Status.CANCELLED
                registration.save(update_fields=["status"])
                if freed_place and event.registration_open:
                    waiting = event.registrations.filter(
                        status=Registration.Status.WAITLISTED
                    ).first()
                    if waiting:
                        waiting.status = Registration.Status.REGISTERED
                        waiting.save(update_fields=["status"])
                        emails.promoted(waiting)
        event = self.get_object()
        return Response(self.get_serializer(event).data)

    @action(detail=True, methods=["get"])
    def registrations(self, request, slug=None):
        event = self._manageable()
        registrations = event.registrations.select_related("profile")
        return Response(RegistrationSerializer(registrations, many=True).data)

    @action(detail=True, methods=["post"], url_path="check-in")
    def check_in(self, request, slug=None):
        """An organiser scans a ticket's QR code, or ticks a person on the list."""
        event = self._manageable()
        data = CheckInSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        lookup = (
            {"ticket_code": data.validated_data["ticket_code"]}
            if "ticket_code" in data.validated_data
            else {"id": data.validated_data["registration"]}
        )
        registration = event.registrations.select_related("profile").filter(**lookup).first()
        if registration is None:
            raise NotFound("This ticket is not for this event.")
        if registration.status != Registration.Status.REGISTERED:
            raise ValidationError(
                f"This registration is {registration.get_status_display().lower()}."
            )
        if event.status not in (Event.Status.PUBLISHED, Event.Status.COMPLETED):
            raise ValidationError("Check-in is only open for published events.")
        already = registration.checked_in_at is not None
        if not already:
            registration.checked_in_at = timezone.now()
            registration.checked_in_by = access.profile_of(request)
            registration.save(update_fields=["checked_in_at", "checked_in_by"])
        return Response(
            {"already_checked_in": already, **RegistrationSerializer(registration).data}
        )

    @check_in.mapping.delete
    def undo_check_in(self, request, slug=None):
        event = self._manageable()
        registration = get_object_or_404(
            event.registrations, id=request.query_params.get("registration")
        )
        registration.checked_in_at = None
        registration.checked_in_by = None
        registration.save(update_fields=["checked_in_at", "checked_in_by"])
        return Response(RegistrationSerializer(registration).data)

    @action(detail=True, methods=["get", "post"], permission_classes=[permissions.IsAuthenticated])
    def feedback(self, request, slug=None):
        """GET: organisers read all feedback. POST: an attendee rates the event."""
        event = self.get_object()
        if request.method == "GET":
            access.require_manage(request, event.organization_id, ROLE)
            feedback = Feedback.objects.filter(registration__event=event)
            return Response(FeedbackSerializer(feedback, many=True).data)
        registration = event.registrations.filter(profile=access.profile_of(request)).first()
        if registration is None or registration.checked_in_at is None:
            raise PermissionDenied("Only people who attended can give feedback.")
        data = FeedbackSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        feedback, _ = Feedback.objects.update_or_create(
            registration=registration, defaults=data.validated_data
        )
        return Response(FeedbackSerializer(feedback).data)

    @action(detail=True, methods=["get"])
    def stats(self, request, slug=None):
        event = self._manageable()
        counts = event.registrations.aggregate(
            registered=Count("id", filter=Q(status=Registration.Status.REGISTERED)),
            waitlisted=Count("id", filter=Q(status=Registration.Status.WAITLISTED)),
            cancelled=Count("id", filter=Q(status=Registration.Status.CANCELLED)),
            checked_in=Count("id", filter=Q(checked_in_at__isnull=False)),
        )
        feedback = Feedback.objects.filter(registration__event=event).aggregate(
            count=Count("id"), average=Avg("rating")
        )
        registered = counts["registered"]
        return Response(
            {
                **counts,
                "capacity": event.capacity,
                "attendance_rate": counts["checked_in"] / registered if registered else None,
                "feedback_count": feedback["count"],
                "average_rating": feedback["average"],
            }
        )

    @action(detail=True, methods=["get"], permission_classes=[permissions.IsAuthenticated])
    def certificate(self, request, slug=None):
        """The member's participation certificate, once they attended and the event is over."""
        event = self.get_object()
        registration = event.registrations.filter(profile=access.profile_of(request)).first()
        if registration is None or not registration.certificate_available:
            raise NotFound("A certificate is issued once you have attended and the event is over.")
        return Response(certificate_payload(registration))


def certificate_payload(registration) -> dict:
    event = registration.event
    return {
        "certificate_code": registration.certificate_code,
        "recipient": registration.profile.display_name,
        "event": event.title,
        "event_type": event.get_event_type_display(),
        "organization": event.organization.name,
        "starts_at": event.starts_at,
        "ends_at": event.ends_at,
    }


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def verify_certificate(request, code):
    """Anyone holding a certificate's code can confirm it is genuine."""
    registration = get_object_or_404(
        Registration.objects.select_related("event__organization", "profile"),
        certificate_code=code,
    )
    if not registration.certificate_available:
        raise NotFound()
    return Response(certificate_payload(registration))


class EventChildViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Announcements and resources: anyone who can see the event reads, organisers write."""

    pagination_class = None
    model = None

    def _event(self):
        return get_object_or_404(visible_events(self.request), slug=self.kwargs["event_slug"])

    def get_queryset(self):
        return self.model.objects.filter(event=self._event())

    def perform_create(self, serializer):
        event = self._event()
        access.require_manage(self.request, event.organization_id, ROLE)
        self.save(serializer, event)

    def save(self, serializer, event):
        serializer.save(event=event)

    def perform_destroy(self, instance):
        access.require_manage(self.request, instance.event.organization_id, ROLE)
        instance.delete()


class AnnouncementViewSet(EventChildViewSet):
    model = Announcement
    serializer_class = AnnouncementSerializer

    def save(self, serializer, event):
        notify = serializer.validated_data.pop("notify", False)
        announcement = serializer.save(event=event, created_by=access.profile_of(self.request))
        if notify:
            announcement.emailed_to = emails.announcement(announcement)


class ResourceViewSet(EventChildViewSet):
    model = Resource
    serializer_class = ResourceSerializer
