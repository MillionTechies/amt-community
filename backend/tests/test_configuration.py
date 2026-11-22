from urllib.parse import parse_qs, urlparse

import pytest
from django.core import mail

from apps.configuration import config, storage
from apps.configuration.mail import ConfiguredEmailBackend
from apps.configuration.models import Setting
from apps.integrations.providers import PROVIDERS
from tests.conftest import sign_in
from tests.test_events import create_event


@pytest.fixture
def root():
    return sign_in("root", platform_admin=True)


def save(client, scope, values):
    return client.put(f"/api/configuration/{scope}/", {"values": values}, format="json")


def field(groups, key):
    return next(f for g in groups for f in g["fields"] if f["key"] == key)


def test_who_can_change_what(root, admin, bob, org, other_org):
    assert [s["id"] for s in root.get("/api/configuration/").json()][0] == "platform"
    assert [s["id"] for s in admin.get("/api/configuration/").json()] == [org.id]
    assert bob.get("/api/configuration/").json() == []

    assert admin.get("/api/configuration/platform/").status_code == 403
    assert admin.get(f"/api/configuration/{other_org.id}/").status_code == 403
    assert bob.get(f"/api/configuration/{org.id}/").status_code == 403
    assert root.get(f"/api/configuration/{org.id}/").status_code == 200

    # Organisations override only what makes sense per organisation.
    org_keys = {f["key"] for g in admin.get(f"/api/configuration/{org.id}/").json() for f in g["fields"]}
    assert "google.client_id" in org_keys and "email.from_name" in org_keys
    assert "email.host" not in org_keys and "storage.bucket" not in org_keys
    assert save(admin, org.id, {"email.host": "smtp.evil.example"}).status_code == 400


def test_secrets_are_stored_sealed_and_never_shown(root, settings):
    settings.GOOGLE_OAUTH_CLIENT_ID = ""
    settings.GOOGLE_OAUTH_CLIENT_SECRET = ""
    assert not PROVIDERS["google"].configured()
    groups = save(root, "platform", {"google.client_id": "plat-id", "google.client_secret": "plat-secret"}).json()
    secret = field(groups, "google.client_secret")
    assert secret["is_set"] and secret["value"] == "" and secret["source"] == "platform"
    assert field(groups, "google.client_id")["value"] == "plat-id"
    assert "plat-secret" not in Setting.objects.get(key="google.client_secret").value
    assert PROVIDERS["google"].configured() and PROVIDERS["google"].client_secret() == "plat-secret"
    assert next(g for g in groups if g["id"] == "google")["redirect_uri"].endswith("/api/integrations/google/callback/")

    save(root, "platform", {"google.client_secret": None})
    assert not PROVIDERS["google"].configured()


def test_environment_values_show_as_defaults(root, settings):
    settings.EMAIL_HOST = "smtp.from-env.example"
    host = field(root.get("/api/configuration/platform/").json(), "email.host")
    assert host["value"] == "" and host["inherited"] == "smtp.from-env.example" and host["source"] == "environment"


def test_an_organisation_can_use_its_own_app(root, admin, org, settings):
    save(root, "platform", {"zoom.client_id": "plat", "zoom.client_secret": "plat-secret"})
    zoom = PROVIDERS["zoom"]
    assert zoom.app_for(org.id) is None  # the platform's app until the organisation sets its own

    groups = save(admin, org.id, {"zoom.client_id": "jkuat", "zoom.client_secret": "jkuat-secret"}).json()
    assert next(g for g in groups if g["id"] == "zoom")["own"] is True
    assert zoom.app_for(org.id) == org.id and zoom.client_id(org.id) == "jkuat"
    assert zoom.client_id() == "plat"  # everyone else is unaffected

    listed = admin.get("/api/integrations/").json()
    assert {(i["id"], i["app"]) for i in listed if i["id"] == "zoom"} == {("zoom", None), ("zoom", org.id)}
    for_org = admin.get(f"/api/integrations/?organization={org.id}").json()
    assert next(i for i in for_org if i["id"] == "zoom")["app_name"] == "JKUAT"

    start = admin.post("/api/integrations/zoom/", {"app": org.id}, format="json").json()
    assert parse_qs(urlparse(start["authorize_url"]).query)["client_id"] == ["jkuat"]


def test_organisations_send_under_their_own_name(root, admin, bob, org):
    save(root, "platform", {"email.from_address": "events@amilliontechies.com"})
    save(admin, org.id, {"email.from_name": "JKUAT Tech Club", "email.reply_to": "club@jkuat.example"})
    event = create_event(admin, org)
    bob.post(f"/api/events/{event['slug']}/register/")
    message = mail.outbox[-1]
    assert message.from_email == "JKUAT Tech Club <events@amilliontechies.com>"
    assert message.reply_to == ["club@jkuat.example"]


def test_sending_a_test_email(root):
    response = root.post("/api/configuration/platform/test-email/", {"to": "me@example.com"}, format="json")
    assert response.status_code == 200 and mail.outbox[-1].to == ["me@example.com"]
    assert root.post("/api/configuration/platform/test-email/", {"to": "nope"}, format="json").status_code == 400


def test_smtp_and_storage_follow_the_page(root, settings, tmp_path):
    save(root, "platform", {"email.host": "smtp.example.com", "email.port": "587", "email.use_tls": True, "email.username": "u", "email.password": "p"})
    backend = ConfiguredEmailBackend()
    assert (backend.host, backend.port, backend.use_tls, backend.username, backend.password) == ("smtp.example.com", 587, True, "u", "p")
    assert save(root, "platform", {"email.port": "five"}).status_code == 400

    settings.MEDIA_ROOT = tmp_path
    assert type(storage.current()).__name__ == "FileSystemStorage"
    save(root, "platform", {"storage.bucket": "amt-media", "storage.access_key_id": "k", "storage.secret_access_key": "s"})
    assert type(storage.current()).__name__ == "S3Storage"
    config.forget()


def test_unknown_organisation_is_not_found(root):
    assert root.get("/api/configuration/org-missing/").status_code == 404


def test_bad_values_are_refused_and_nothing_is_saved(root):
    assert save(root, "platform", ["email.host"]).status_code == 400
    response = save(root, "platform", {
        "no.such.key": "x",
        "email.host": ["a", "list"],
        "email.from_address": "not-an-address",
        "storage.endpoint_url": "s3.example.com",
        "email.use_ssl": False,
    })
    assert response.status_code == 400
    errors = response.json()
    assert set(errors) == {"no.such.key", "email.host", "email.from_address", "storage.endpoint_url"}
    assert errors["email.host"] == "Use text."
    assert errors["email.from_address"] == "Use an email address."
    assert errors["storage.endpoint_url"] == "Use a full address starting with https://."
    assert not Setting.objects.exists()


def test_good_email_url_and_boolean_values_are_saved(root):
    response = save(root, "platform", {
        "email.from_address": "events@example.com",
        "storage.endpoint_url": "https://s3.example.com",
        "email.use_ssl": False,
    })
    assert response.status_code == 200
    assert config.get("email.from_address") == "events@example.com"
    assert config.get("storage.endpoint_url") == "https://s3.example.com"
    stored = Setting.objects.get(key="email.use_ssl")
    assert stored.value == "false"
    assert str(stored) == "email.use_ssl (platform)"


def test_a_failed_test_email_shows_the_mail_servers_words(root, monkeypatch):
    def refuse(self):
        raise ConnectionRefusedError("Connection refused")

    monkeypatch.setattr("django.core.mail.EmailMultiAlternatives.send", refuse)
    response = root.post("/api/configuration/platform/test-email/", {"to": "me@example.com"}, format="json")
    assert response.status_code == 400
    assert response.json() == {"to": "Could not send: Connection refused"}


def test_settings_no_longer_known_are_ignored(org):
    Setting.objects.create(key="retired.setting", value="old")
    Setting.objects.create(organization=org, key="email.from_name", value="JKUAT")
    config.forget()
    assert config._stored() == {(org.id, "email.from_name"): "JKUAT"}
    assert str(Setting.objects.get(key="email.from_name")) == f"email.from_name ({org.id})"
