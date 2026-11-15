import uuid

from django.db import models
from django.utils import timezone

from apps.accounts.models import Profile


class Event(models.Model):
    class Type(models.TextChoices):
        WORKSHOP = "workshop", "Technical workshop"
        OUTREACH = "outreach", "University outreach"
        CONFERENCE = "conference", "Conference"
        MEETUP = "meetup", "Developer meetup"
        WEBINAR = "webinar", "Webinar"
        TRAINING = "training", "Training session"
        NETWORKING = "networking", "Networking event"

    class Mode(models.TextChoices):
        IN_PERSON = "in_person", "In person"
        ONLINE = "online", "Online"
        HYBRID = "hybrid", "Hybrid"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PUBLISHED = "published", "Published"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    organization = models.ForeignKey(
        "amt_auth.Organization", on_delete=models.PROTECT, related_name="events"
    )
    title = models.CharField(max_length=200)
    summary = models.CharField(max_length=300, blank=True)
    description = models.TextField(blank=True)
    event_type = models.CharField(max_length=20, choices=Type.choices, default=Type.WORKSHOP)
    delivery_mode = models.CharField(max_length=20, choices=Mode.choices, default=Mode.IN_PERSON)
    venue = models.CharField(max_length=255, blank=True)
    online_url = models.URLField(blank=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    registration_deadline = models.DateTimeField(null=True, blank=True)
    capacity = models.PositiveIntegerField(null=True, blank=True)  # None: no limit
    eligibility = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    created_by = models.ForeignKey(Profile, on_delete=models.SET_NULL, null=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["starts_at"]
        indexes = [models.Index(fields=["status", "starts_at"])]

    def __str__(self) -> str:
        return self.title

    @property
    def registration_closes_at(self):
        return self.registration_deadline or self.ends_at

    @property
    def registration_open(self) -> bool:
        return self.status == self.Status.PUBLISHED and timezone.now() < self.registration_closes_at


class Registration(models.Model):
    class Status(models.TextChoices):
        REGISTERED = "registered", "Registered"
        WAITLISTED = "waitlisted", "Waitlisted"
        CANCELLED = "cancelled", "Cancelled"

    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="registrations")
    profile = models.ForeignKey(
        Profile, on_delete=models.CASCADE, related_name="event_registrations"
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.REGISTERED)
    # The ticket: shown as a QR code by the attendee, scanned by an organiser.
    ticket_code = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    # Printed on the participation certificate, so anyone can verify it.
    certificate_code = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    checked_in_at = models.DateTimeField(null=True, blank=True)
    checked_in_by = models.ForeignKey(
        Profile, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(fields=["event", "profile"], name="unique_event_registration")
        ]

    def __str__(self) -> str:
        return f"{self.profile} at {self.event}"

    @property
    def certificate_available(self) -> bool:
        return self.checked_in_at is not None and (
            self.event.status == Event.Status.COMPLETED or self.event.ends_at <= timezone.now()
        )


class Announcement(models.Model):
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="announcements")
    title = models.CharField(max_length=200)
    body = models.TextField()
    created_by = models.ForeignKey(Profile, on_delete=models.SET_NULL, null=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class Resource(models.Model):
    """A link to slides, a recording, a repository or other learning material."""

    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="resources")
    title = models.CharField(max_length=200)
    url = models.URLField()
    description = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


class Feedback(models.Model):
    registration = models.OneToOneField(
        Registration, on_delete=models.CASCADE, related_name="feedback"
    )
    rating = models.PositiveSmallIntegerField()  # 1 to 5
    comment = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(rating__gte=1, rating__lte=5), name="feedback_rating_1_to_5"
            )
        ]
