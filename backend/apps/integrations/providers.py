"""Google, Microsoft and Zoom: OAuth sign-in, and creating, updating and removing events there.

- Google: an event in the organiser's Google Calendar, with a Google Meet link if asked.
- Microsoft: an event in the organiser's Outlook calendar, with a Teams link if asked.
- Zoom: a scheduled Zoom meeting (Zoom has no calendar of its own).

Each provider needs an app registered in its developer console. Its keys are set on the
Configuration page, by platform admins for everyone, or by an organisation's admins for that
organisation alone. Until they are set, the provider shows as "not set up".
"""

import base64
import json
import uuid
from datetime import UTC, timedelta
from urllib.parse import urlencode

import httpx
from django.conf import settings

from apps.configuration import config
from apps.configuration.registry import GROUPS
from apps.content.richtext import to_text
from apps.integrations import calendar


def http() -> httpx.Client:
    """One place to make HTTP clients, so tests can swap in a fake transport."""
    return httpx.Client(timeout=20)


class ProviderError(Exception):
    """The provider refused or could not be reached. The message is safe to show."""


def _check(response: httpx.Response, doing: str) -> dict:
    if response.status_code >= 400:
        try:
            detail = response.json()
        except ValueError:
            detail = response.text[:200]
        raise ProviderError(f"Could not {doing} ({response.status_code}): {detail}")
    return response.json() if response.content else {}


def _iso(dt) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _details(event) -> str:
    parts = [event.summary or to_text(event.description)[:1500], f"Event page: {calendar.event_url(event)}"]
    return "\n\n".join(p for p in parts if p)


class Provider:
    id = ""
    name = ""
    meeting_name = ""  # what its meetings are called, "" if it cannot make them
    has_calendar = False
    authorize_url_base = ""
    token_url = ""
    scopes: list[str] = []

    def authorize_endpoint(self, app=None) -> str:
        return self.authorize_url_base

    def token_endpoint(self, app=None) -> str:
        return self.token_url

    # --- configuration -------------------------------------------------------------------
    # An "app" is whose OAuth app to use: an organisation's id when it registered its own
    # (on the Configuration page), or None for the platform's.

    def client_id(self, app=None) -> str:
        return config.get(f"{self.id}.client_id", app)

    def client_secret(self, app=None) -> str:
        return config.get(f"{self.id}.client_secret", app)

    def configured(self, app=None) -> bool:
        return bool(self.client_id(app) and self.client_secret(app))

    def app_for(self, organization_id) -> str | None:
        """The app an organisation's events use: its own if it set one up, else the platform's."""
        group = next(g for g in GROUPS if g.id == self.id)
        if organization_id and config.has_own(self.id, organization_id, group.required):
            return organization_id
        return None

    @property
    def redirect_uri(self) -> str:
        return f"{settings.API_URL}/api/integrations/{self.id}/callback/"

    # --- OAuth ---------------------------------------------------------------------------

    def authorize_url(self, state: str, app=None) -> str:
        params = {
            "client_id": self.client_id(app),
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": " ".join(self.scopes),
            "state": state,
            **self.extra_authorize_params(),
        }
        return f"{self.authorize_endpoint(app)}?{urlencode(params)}"

    def extra_authorize_params(self) -> dict:
        return {}

    def _token_request(self, data: dict, app=None) -> dict:
        with http() as client:
            response = client.post(
                self.token_endpoint(app),
                data={**data, "client_id": self.client_id(app), "client_secret": self.client_secret(app)},
            )
        return _check(response, f"sign in to {self.name}")

    def exchange(self, code: str, app=None) -> dict:
        """Trade the code from the callback for tokens. Returns the token response."""
        return self._token_request(
            {"grant_type": "authorization_code", "code": code, "redirect_uri": self.redirect_uri}, app
        )

    def refresh(self, refresh_token: str, app=None) -> dict:
        return self._token_request({"grant_type": "refresh_token", "refresh_token": refresh_token}, app)

    def account_email(self, tokens: dict) -> str:
        return ""

    # --- events --------------------------------------------------------------------------

    def create(self, token: str, event, *, meeting: bool) -> tuple[str, str]:
        """Create the event there. Returns (its id there, the meeting's join link or "")."""
        raise NotImplementedError

    def update(self, token: str, external_id: str, event) -> None:
        raise NotImplementedError

    def delete(self, token: str, external_id: str) -> None:
        raise NotImplementedError


def _jwt_claims(token: str) -> dict:
    """Claims of an id_token straight from the provider's token endpoint (over TLS)."""
    try:
        payload = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError):
        return {}


class Google(Provider):
    id = "google"
    name = "Google"
    meeting_name = "Google Meet"
    has_calendar = True
    authorize_url_base = "https://accounts.google.com/o/oauth2/v2/auth"
    token_url = "https://oauth2.googleapis.com/token"
    scopes = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"]
    api = "https://www.googleapis.com/calendar/v3/calendars/primary/events"

    def extra_authorize_params(self):
        # offline + consent: always return a refresh token, so syncing keeps working.
        return {"access_type": "offline", "prompt": "consent", "include_granted_scopes": "true"}

    def account_email(self, tokens):
        return _jwt_claims(tokens.get("id_token", "")).get("email", "")

    def _body(self, event) -> dict:
        return {
            "summary": event.title,
            "description": _details(event),
            "location": calendar.location(event, with_link=True),
            "start": {"dateTime": _iso(event.starts_at)},
            "end": {"dateTime": _iso(event.ends_at)},
            "source": {"title": "A Million Techies Community", "url": calendar.event_url(event)},
        }

    def create(self, token, event, *, meeting):
        body = self._body(event)
        if meeting:
            body["conferenceData"] = {
                "createRequest": {"requestId": uuid.uuid4().hex, "conferenceSolutionKey": {"type": "hangoutsMeet"}}
            }
        with http() as client:
            data = _check(
                client.post(f"{self.api}?conferenceDataVersion=1", json=body, headers={"Authorization": f"Bearer {token}"}),
                "create the Google Calendar event",
            )
        join = data.get("hangoutLink", "")
        if meeting and not join:
            for point in data.get("conferenceData", {}).get("entryPoints", []):
                if point.get("entryPointType") == "video":
                    join = point.get("uri", "")
        return data["id"], join

    def update(self, token, external_id, event):
        with http() as client:
            _check(
                client.patch(f"{self.api}/{external_id}", json=self._body(event), headers={"Authorization": f"Bearer {token}"}),
                "update the Google Calendar event",
            )

    def delete(self, token, external_id):
        with http() as client:
            response = client.delete(f"{self.api}/{external_id}", headers={"Authorization": f"Bearer {token}"})
        if response.status_code not in (404, 410):
            _check(response, "remove the Google Calendar event")


class Microsoft(Provider):
    id = "microsoft"
    name = "Microsoft"
    meeting_name = "Microsoft Teams"
    has_calendar = True
    scopes = ["openid", "email", "offline_access", "User.Read", "Calendars.ReadWrite"]
    api = "https://graph.microsoft.com/v1.0/me/events"

    def tenant(self, app=None) -> str:
        return config.get("microsoft.tenant", app) or "common"

    def authorize_endpoint(self, app=None):
        return f"https://login.microsoftonline.com/{self.tenant(app)}/oauth2/v2.0/authorize"

    def token_endpoint(self, app=None):
        return f"https://login.microsoftonline.com/{self.tenant(app)}/oauth2/v2.0/token"

    def account_email(self, tokens):
        claims = _jwt_claims(tokens.get("id_token", ""))
        return claims.get("email") or claims.get("preferred_username", "")

    def _body(self, event) -> dict:
        return {
            "subject": event.title,
            "body": {"contentType": "text", "content": _details(event)},
            "start": {"dateTime": _iso(event.starts_at).rstrip("Z"), "timeZone": "UTC"},
            "end": {"dateTime": _iso(event.ends_at).rstrip("Z"), "timeZone": "UTC"},
            "location": {"displayName": calendar.location(event, with_link=True)},
        }

    def create(self, token, event, *, meeting):
        body = self._body(event)
        if meeting:
            body.update({"isOnlineMeeting": True, "onlineMeetingProvider": "teamsForBusiness"})
        with http() as client:
            data = _check(
                client.post(self.api, json=body, headers={"Authorization": f"Bearer {token}"}),
                "create the Outlook calendar event",
            )
        join = (data.get("onlineMeeting") or {}).get("joinUrl", "") if meeting else ""
        return data["id"], join

    def update(self, token, external_id, event):
        with http() as client:
            _check(
                client.patch(f"{self.api}/{external_id}", json=self._body(event), headers={"Authorization": f"Bearer {token}"}),
                "update the Outlook calendar event",
            )

    def delete(self, token, external_id):
        with http() as client:
            response = client.delete(f"{self.api}/{external_id}", headers={"Authorization": f"Bearer {token}"})
        if response.status_code != 404:
            _check(response, "remove the Outlook calendar event")


class Zoom(Provider):
    id = "zoom"
    name = "Zoom"
    meeting_name = "Zoom"
    authorize_url_base = "https://zoom.us/oauth/authorize"
    token_url = "https://zoom.us/oauth/token"
    scopes: list[str] = []  # set on the Zoom app itself
    api = "https://api.zoom.us/v2"

    def authorize_url(self, state, app=None):
        params = {"client_id": self.client_id(app), "redirect_uri": self.redirect_uri, "response_type": "code", "state": state}
        return f"{self.authorize_endpoint(app)}?{urlencode(params)}"

    def _token_request(self, data, app=None):
        # Zoom wants the client credentials as Basic auth, not in the form.
        with http() as client:
            response = client.post(self.token_endpoint(app), data=data, auth=(self.client_id(app), self.client_secret(app)))
        return _check(response, "sign in to Zoom")

    def account_email(self, tokens):
        with http() as client:
            response = client.get(f"{self.api}/users/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
        return response.json().get("email", "") if response.status_code == 200 else ""

    def _body(self, event) -> dict:
        minutes = max(15, int((event.ends_at - event.starts_at) / timedelta(minutes=1)))
        return {
            "topic": event.title[:200],
            "type": 2,  # scheduled
            "start_time": _iso(event.starts_at),
            "timezone": "UTC",
            "duration": minutes,
            "agenda": _details(event)[:2000],
        }

    def create(self, token, event, *, meeting):
        with http() as client:
            data = _check(
                client.post(f"{self.api}/users/me/meetings", json=self._body(event), headers={"Authorization": f"Bearer {token}"}),
                "create the Zoom meeting",
            )
        return str(data["id"]), data.get("join_url", "")

    def update(self, token, external_id, event):
        with http() as client:
            _check(
                client.patch(f"{self.api}/meetings/{external_id}", json=self._body(event), headers={"Authorization": f"Bearer {token}"}),
                "update the Zoom meeting",
            )

    def delete(self, token, external_id):
        with http() as client:
            response = client.delete(f"{self.api}/meetings/{external_id}", headers={"Authorization": f"Bearer {token}"})
        if response.status_code != 404:
            _check(response, "remove the Zoom meeting")


PROVIDERS = {p.id: p for p in (Google(), Microsoft(), Zoom())}
