"""Tokens for people's Google, Microsoft and Zoom accounts are stored encrypted."""

import base64
import hashlib

from cryptography.fernet import Fernet
from django.conf import settings


def _fernet() -> Fernet:
    key = settings.INTEGRATIONS_ENCRYPTION_KEY or base64.urlsafe_b64encode(
        hashlib.sha256(f"integrations:{settings.SECRET_KEY}".encode()).digest()
    ).decode()
    return Fernet(key.encode())


def seal(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode() if value else ""


def unseal(value: str) -> str:
    return _fernet().decrypt(value.encode()).decode() if value else ""
