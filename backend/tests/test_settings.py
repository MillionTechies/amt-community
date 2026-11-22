"""config/settings.py read afresh under different environments."""

import os
import runpy
from pathlib import Path

import pytest

SETTINGS = Path(__file__).resolve().parent.parent / "config" / "settings.py"


def load(monkeypatch, **env):
    monkeypatch.setattr(os, "environ", {**os.environ, **env})
    return runpy.run_path(str(SETTINGS))


def test_production_needs_a_secret_key(monkeypatch):
    with pytest.raises(RuntimeError, match="Set DJANGO_SECRET_KEY"):
        load(monkeypatch, DJANGO_SECRET_KEY="", DJANGO_DEBUG="false")


@pytest.mark.parametrize("debug, secret_key, expected_key, production", [
    ("true", "", "dev-only-insecure-key", False),
    ("false", "from-the-environment", "from-the-environment", True),
])
def test_production_secures_cookies_behind_the_proxy_and_development_works_over_http(monkeypatch, debug, secret_key, expected_key, production):
    loaded = load(
        monkeypatch, DJANGO_SECRET_KEY=secret_key, DJANGO_DEBUG=debug,
        CSRF_TRUSTED_ORIGINS="https://community.amilliontechies.com, https://api.community.amilliontechies.com",
    )
    assert loaded["DEBUG"] is not production
    assert loaded["SECRET_KEY"] == expected_key
    assert loaded["SESSION_COOKIE_SECURE"] is production and loaded["CSRF_COOKIE_SECURE"] is production
    assert loaded["SECURE_PROXY_SSL_HEADER"] == ("HTTP_X_FORWARDED_PROTO", "https")
    assert loaded["USE_X_FORWARDED_HOST"] is True
    assert loaded["CSRF_TRUSTED_ORIGINS"] == [
        "https://community.amilliontechies.com", "https://api.community.amilliontechies.com",
    ]
