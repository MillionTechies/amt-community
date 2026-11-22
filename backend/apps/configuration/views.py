"""The Configuration page's API.

GET  /api/configuration/                    which scopes you may edit (platform, organisations)
GET  /api/configuration/<scope>/            its groups and fields, with values and where they come from
PUT  /api/configuration/<scope>/            {"values": {key: value}}: set; null or "" clears
POST /api/configuration/<scope>/test-email/ {"to": address}: send a test with the current settings

<scope> is "platform" or an organisation's id. Secret values are never sent back, only whether
they are set.
"""

from amt_auth.django.models import Organization
from django.conf import settings
from django.core.mail import EmailMultiAlternatives, get_connection
from rest_framework import permissions
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts import access
from apps.configuration import config
from apps.configuration.mail import sender
from apps.configuration.models import Setting, seal
from apps.configuration.registry import FIELDS, GROUPS
from apps.integrations.providers import PROVIDERS


def _scope(request, scope: str) -> str | None:
    """None for the platform, else the organisation id, after checking who is asking."""
    if scope == "platform":
        if not access.is_platform_admin(request):
            raise PermissionDenied("Only platform admins can change platform settings.")
        return None
    if not Organization.objects.filter(id=scope, deleted_at=None).exists():
        raise NotFound("Unknown organisation.")
    if not access.is_org_admin(request, scope):
        raise PermissionDenied("Only this organisation's admins can change its settings.")
    return scope


def _editable(field, org) -> bool:
    return org is None or field.scope == "both"


def _field_data(field, org) -> dict:
    stored = config._stored()
    own = stored.get((org, field.key), "")
    value, source = config.lookup(field.key, org)
    inherited = "" if source == "organization" or (org is None and source == "platform") else value
    data = {
        "key": field.key,
        "label": field.label,
        "kind": field.kind,
        "help": field.help,
        "placeholder": field.placeholder,
        "source": source,
        "is_set": bool(own),
    }
    if field.kind == "secret":
        data["value"] = ""
        data["inherited"] = "set" if inherited else ""
    else:
        data["value"] = own
        data["inherited"] = inherited
    return data


def _group_data(group, org) -> dict:
    fields = [f for f in group.fields if _editable(f, org)]
    ready = all(config.get(key, org) for key in group.required)
    own = org is not None and config.has_own(group.id, org, group.required) if group.required else False
    data = {
        "id": group.id,
        "title": group.title,
        "description": group.description,
        "fields": [_field_data(f, org) for f in fields],
        "ready": ready,
        "own": own,
    }
    if group.id in PROVIDERS:
        data["redirect_uri"] = PROVIDERS[group.id].redirect_uri
    return data


class ScopesView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        scopes = []
        if access.is_platform_admin(request):
            scopes.append({"id": "platform", "name": "Platform", "kind": "platform"})
        orgs = Organization.objects.filter(id__in=access.admin_org_ids(request), deleted_at=None)
        scopes += [{"id": o.id, "name": o.name, "kind": "organization"} for o in orgs.order_by("name")]
        return Response(scopes)


class ConfigurationView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, scope):
        org = _scope(request, scope)
        groups = [_group_data(g, org) for g in GROUPS]
        return Response([g for g in groups if g["fields"]])

    def put(self, request, scope):
        org = _scope(request, scope)
        values = request.data.get("values")
        if not isinstance(values, dict):
            raise ValidationError({"values": "Send the settings to change as an object."})
        errors = {}
        for key, value in values.items():
            field = FIELDS.get(key)
            if field is None or not _editable(field, org):
                errors[key] = "This setting cannot be changed here."
                continue
            if value is not None and not isinstance(value, (str, int, bool)):
                errors[key] = "Use text."
                continue
            if isinstance(value, bool):
                value = "true" if value else "false"
            value = "" if value is None else str(value).strip()
            if value and field.kind == "number" and not value.isdigit():
                errors[key] = "Use a whole number."
            if value and field.kind == "email" and "@" not in value:
                errors[key] = "Use an email address."
            if value and field.kind == "url" and not value.startswith(("https://", "http://")):
                errors[key] = "Use a full address starting with https://."
        if errors:
            raise ValidationError(errors)
        profile = access.profile_of(request)
        for key, value in values.items():
            field = FIELDS[key]
            value = "true" if value is True else "false" if value is False else ("" if value is None else str(value).strip())
            if not value:
                Setting.objects.filter(organization_id=org, key=key).delete()
                continue
            Setting.objects.update_or_create(
                organization_id=org, key=key,
                defaults={"value": seal(value) if field.kind == "secret" else value, "updated_by": profile},
            )
        config.forget()
        return self.get(request, scope)


class TestEmailView(APIView):
    """Send one email with the current settings, so an admin can check them straight away."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, scope):
        org = _scope(request, scope)
        to = (request.data.get("to") or "").strip()
        if "@" not in to:
            raise ValidationError({"to": "Enter the address to send the test to."})
        from_header, reply_to = sender(org)
        message = EmailMultiAlternatives(
            "Test email from A Million Techies Community",
            "This is a test. If you can read it, Community can send email with these settings.",
            from_header, [to], reply_to=reply_to,
            connection=get_connection(settings.EMAIL_BACKEND, fail_silently=False),
        )
        try:
            message.send()
        except Exception as error:  # show the mail server's own words
            raise ValidationError({"to": f"Could not send: {error}"}) from None
        return Response({"sent_to": to, "from": from_header})
