from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from django.core import mail
from django.urls import reverse
from django.utils import timezone
from model_bakery import baker

from apps.configuration import config, storage
from apps.configuration.mail import ConfiguredEmailBackend
from apps.configuration.models import Setting
from apps.events.models import Event
from apps.integrations.providers import PROVIDERS
from tests.conftest import sign_in


@pytest.fixture
def root():
    return sign_in("root", platform_admin=True)


def configuration(scope):
    return reverse("configuration", kwargs={"scope": scope})


def save(client, scope, values):
    return client.put(configuration(scope), {"values": values}, format="json")


def field(groups, key):
    return next(f for g in groups for f in g["fields"] if f["key"] == key)


def test_who_can_change_what(root, admin, bob, org, other_org):
    # Platform admins change the platform's settings, not an organisation's.
    scopes = reverse("configuration-scopes")
    assert [s["id"] for s in root.get(scopes).json()] == ["platform"]
    assert [s["id"] for s in admin.get(scopes).json()] == [org.id]
    assert bob.get(scopes).json() == []

    assert admin.get(configuration("platform")).status_code == 403
    assert admin.get(configuration(other_org.id)).status_code == 403
    assert bob.get(configuration(org.id)).status_code == 403
    assert root.get(configuration(org.id)).status_code == 403
    assert root.get(configuration("org-missing")).status_code == 404

    # Organisations override only what makes sense per organisation.
    org_keys = {f["key"] for g in admin.get(configuration(org.id)).json() for f in g["fields"]}
    assert "google.client_id" in org_keys and "email.from_name" in org_keys
    assert "email.host" not in org_keys and "storage.bucket" not in org_keys
    assert save(admin, org.id, {"email.host": "smtp.evil.example"}).status_code == 400


def test_secrets_are_stored_sealed_and_never_shown(root, settings):
    settings.GOOGLE_OAUTH_CLIENT_ID = ""
    settings.GOOGLE_OAUTH_CLIENT_SECRET = ""
    settings.EMAIL_HOST = "smtp.from-env.example"
    assert not PROVIDERS["google"].configured()
    groups = save(root, "platform", {"google.client_id": "plat-id", "google.client_secret": "plat-secret"}).json()
    secret = field(groups, "google.client_secret")
    assert secret["is_set"] and secret["value"] == "" and secret["source"] == "platform"
    assert field(groups, "google.client_id")["value"] == "plat-id"
    assert "plat-secret" not in Setting.objects.get(key="google.client_secret").value
    assert PROVIDERS["google"].configured() and PROVIDERS["google"].client_secret() == "plat-secret"
    redirect = next(g for g in groups if g["id"] == "google")["redirect_uri"]
    assert redirect.endswith(reverse("integration-callback", kwargs={"provider_id": "google"}))
    # Values from the environment show as defaults.
    host = field(groups, "email.host")
    assert host["value"] == "" and host["inherited"] == "smtp.from-env.example" and host["source"] == "environment"

    save(root, "platform", {"google.client_secret": None})
    assert not PROVIDERS["google"].configured()


def test_an_organisation_can_use_its_own_app(root, admin, org):
    save(root, "platform", {"zoom.client_id": "plat", "zoom.client_secret": "plat-secret"})
    zoom = PROVIDERS["zoom"]
    assert zoom.app_for(org.id) is None  # the platform's app until the organisation sets its own

    groups = save(admin, org.id, {"zoom.client_id": "jkuat", "zoom.client_secret": "jkuat-secret"}).json()
    assert next(g for g in groups if g["id"] == "zoom")["own"] is True
    assert zoom.app_for(org.id) == org.id and zoom.client_id(org.id) == "jkuat"
    assert zoom.client_id() == "plat"  # everyone else is unaffected

    listed = admin.get(reverse("integrations")).json()
    assert {(i["id"], i["app"]) for i in listed if i["id"] == "zoom"} == {("zoom", None), ("zoom", org.id)}
    for_org = admin.get(reverse("integrations"), {"organization": org.id}).json()
    assert {i["id"]: i["app_name"] for i in for_org} == {"google": "A Million Techies", "microsoft": "A Million Techies", "zoom": "JKUAT"}

    started = admin.post(reverse("integration", kwargs={"provider_id": "zoom"}), {"app": org.id}, format="json").json()
    assert parse_qs(urlparse(started["authorize_url"]).query)["client_id"] == ["jkuat"]


def test_organisations_send_under_their_own_name(root, admin, bob, org):
    save(root, "platform", {"email.from_address": "events@amilliontechies.com"})
    save(admin, org.id, {"email.from_name": "JKUAT Tech Club", "email.reply_to": "club@jkuat.example"})
    starts_at = timezone.now() + timedelta(days=7)
    event = baker.make(Event, organization=org, status=Event.Status.PUBLISHED, starts_at=starts_at, ends_at=starts_at + timedelta(hours=2))
    bob.post(reverse("event-register", kwargs={"slug": event.slug}))
    message = mail.outbox[-1]
    assert message.from_email == "JKUAT Tech Club <events@amilliontechies.com>"
    assert message.reply_to == ["club@jkuat.example"]


def test_sending_a_test_email_shows_the_mail_servers_words(root, monkeypatch):
    url = reverse("configuration-test-email", kwargs={"scope": "platform"})
    response = root.post(url, {"to": "me@example.com"}, format="json")
    assert response.status_code == 200 and mail.outbox[-1].to == ["me@example.com"]
    assert root.post(url, {"to": "nope"}, format="json").status_code == 400

    def refuse(self):
        raise ConnectionRefusedError("Connection refused")

    monkeypatch.setattr("django.core.mail.EmailMultiAlternatives.send", refuse)
    refused = root.post(url, {"to": "me@example.com"}, format="json")
    assert refused.status_code == 400 and refused.json() == {"to": "Could not send: Connection refused"}


def test_smtp_and_storage_follow_the_page(root, settings, tmp_path):
    save(root, "platform", {"email.host": "smtp.example.com", "email.port": "587", "email.use_tls": True, "email.username": "u", "email.password": "p"})
    backend = ConfiguredEmailBackend()
    assert (backend.host, backend.port, backend.use_tls, backend.username, backend.password) == ("smtp.example.com", 587, True, "u", "p")

    settings.MEDIA_ROOT = tmp_path
    assert type(storage.current()).__name__ == "FileSystemStorage"
    assert storage.ConfiguredStorage().location == str(tmp_path)
    save(root, "platform", {"storage.bucket": "amt-media", "storage.access_key_id": "k", "storage.secret_access_key": "s"})
    assert type(storage.current()).__name__ == "S3Storage"


def test_values_are_checked_before_anything_is_saved(root):
    assert save(root, "platform", ["email.host"]).status_code == 400
    refused = save(root, "platform", {
        "no.such.key": "x",
        "email.host": ["a", "list"],
        "email.port": "five",
        "email.from_address": "not-an-address",
        "storage.endpoint_url": "s3.example.com",
        "email.use_ssl": False,
    })
    assert refused.status_code == 400
    assert refused.json() == {
        "no.such.key": "This setting cannot be changed here.",
        "email.host": "Use text.",
        "email.port": "Use a whole number.",
        "email.from_address": "Use an email address.",
        "storage.endpoint_url": "Use a full address starting with https://.",
    }
    assert not Setting.objects.exists()

    saved = save(root, "platform", {
        "email.from_address": "events@example.com",
        "storage.endpoint_url": "https://s3.example.com",
        "email.use_ssl": False,
    })
    assert saved.status_code == 200
    assert config.get("email.from_address") == "events@example.com"
    assert config.get("storage.endpoint_url") == "https://s3.example.com"
    stored = Setting.objects.get(key="email.use_ssl")
    assert stored.value == "false" and str(stored) == "email.use_ssl (platform)"


def test_settings_no_longer_known_are_ignored(org):
    baker.make(Setting, key="retired.setting", value="old")
    baker.make(Setting, organization=org, key="email.from_name", value="JKUAT")
    assert config._stored() == {(org.id, "email.from_name"): "JKUAT"}
    assert str(Setting.objects.get(key="email.from_name")) == f"email.from_name ({org.id})"
