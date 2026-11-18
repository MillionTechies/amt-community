from django.db import models

from apps.accounts.models import Profile
from apps.integrations import crypto


class Connection(models.Model):
    """An organiser's Google, Microsoft or Zoom account, connected with OAuth."""

    class Provider(models.TextChoices):
        GOOGLE = "google", "Google"
        MICROSOFT = "microsoft", "Microsoft"
        ZOOM = "zoom", "Zoom"

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="connections")
    provider = models.CharField(max_length=20, choices=Provider.choices)
    # Whose OAuth app it was made with: an organisation's own app, or None for the platform's.
    organization = models.ForeignKey(
        "amt_auth.Organization", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    account_email = models.CharField(max_length=254, blank=True)
    access_token_sealed = models.TextField()
    refresh_token_sealed = models.TextField(blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["profile", "provider", "organization"], nulls_distinct=False, name="one_connection_per_app"
            )
        ]

    def __str__(self) -> str:
        return f"{self.profile} on {self.get_provider_display()}"

    @property
    def access_token(self) -> str:
        return crypto.unseal(self.access_token_sealed)

    @access_token.setter
    def access_token(self, value: str) -> None:
        self.access_token_sealed = crypto.seal(value)

    @property
    def refresh_token(self) -> str:
        return crypto.unseal(self.refresh_token_sealed)

    @refresh_token.setter
    def refresh_token(self, value: str) -> None:
        self.refresh_token_sealed = crypto.seal(value)


class EventLink(models.Model):
    """An event's copy in an organiser's calendar or meeting tool, kept in step with the event."""

    event = models.ForeignKey("events.Event", on_delete=models.CASCADE, related_name="external_links")
    connection = models.ForeignKey(Connection, on_delete=models.CASCADE, related_name="links")
    external_id = models.CharField(max_length=500)
    # True when this item is also the event's meeting (Meet, Teams or Zoom).
    is_meeting = models.BooleanField(default=False)
    join_url = models.URLField(max_length=1000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["event", "connection"], name="one_link_per_connection")
        ]
