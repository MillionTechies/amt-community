"""config/settings.py read afresh under different environments."""

import runpy
from pathlib import Path

import pytest

SETTINGS = Path(__file__).resolve().parent.parent / "config" / "settings.py"


def load(monkeypatch, **env):
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    return runpy.run_path(str(SETTINGS))


def test_production_needs_a_secret_key(monkeypatch):
    with pytest.raises(RuntimeError, match="Set DJANGO_SECRET_KEY"):
        load(monkeypatch, DJANGO_SECRET_KEY="", DJANGO_DEBUG="false")


def test_local_development_gets_a_throwaway_key(monkeypatch):
    loaded = load(monkeypatch, DJANGO_SECRET_KEY="", DJANGO_DEBUG="true")
    assert loaded["DEBUG"] is True
    assert loaded["SECRET_KEY"] == "dev-only-insecure-key"


def test_a_secret_key_from_the_environment_is_used(monkeypatch):
    loaded = load(monkeypatch, DJANGO_SECRET_KEY="from-the-environment", DJANGO_DEBUG="false")
    assert loaded["DEBUG"] is False
    assert loaded["SECRET_KEY"] == "from-the-environment"


def test_production_trusts_the_proxy_and_secures_cookies(monkeypatch):
    loaded = load(
        monkeypatch, DJANGO_SECRET_KEY="k", DJANGO_DEBUG="false",
        CSRF_TRUSTED_ORIGINS="https://community.amilliontechies.com, https://api.community.amilliontechies.com",
    )
    assert loaded["SECURE_PROXY_SSL_HEADER"] == ("HTTP_X_FORWARDED_PROTO", "https")
    assert loaded["USE_X_FORWARDED_HOST"] is True
    assert loaded["CSRF_TRUSTED_ORIGINS"] == [
        "https://community.amilliontechies.com", "https://api.community.amilliontechies.com",
    ]
    assert loaded["SESSION_COOKIE_SECURE"] is True
    assert loaded["CSRF_COOKIE_SECURE"] is True


def test_local_development_cookies_work_over_http(monkeypatch):
    loaded = load(monkeypatch, DJANGO_SECRET_KEY="", DJANGO_DEBUG="true")
    assert loaded["SESSION_COOKIE_SECURE"] is False
    assert loaded["CSRF_COOKIE_SECURE"] is False
