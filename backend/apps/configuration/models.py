from django.db import models

from apps.accounts.models import Profile
from apps.integrations import crypto


class Setting(models.Model):
    """One value from the Configuration page. No organisation: the platform-wide value."""

    organization = models.ForeignKey(
        "amt_auth.Organization", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    key = models.CharField(max_length=100)
    value = models.TextField(blank=True)  # sealed when the field is a secret
    updated_by = models.ForeignKey(Profile, on_delete=models.SET_NULL, null=True, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["organization", "key"], nulls_distinct=False, name="one_value_per_scope")
        ]

    def __str__(self) -> str:
        return f"{self.key} ({self.organization_id or 'platform'})"


def seal(value: str) -> str:
    return crypto.seal(value)


def unseal(value: str) -> str:
    return crypto.unseal(value)
