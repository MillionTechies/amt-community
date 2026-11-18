import uuid

from django.db import models
from django.utils import timezone

from apps.accounts.models import Profile


def upload_path(instance, filename: str) -> str:
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    return f"uploads/{timezone.now():%Y/%m}/{uuid.uuid4().hex}.{extension}"


class Upload(models.Model):
    """An image an organiser added to a description or announcement."""

    file = models.ImageField(upload_to=upload_path)
    uploaded_by = models.ForeignKey(Profile, on_delete=models.SET_NULL, null=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

