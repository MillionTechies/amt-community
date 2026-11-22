from django.conf import settings
from django.core import signing
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404, redirect
from rest_framework import permissions, status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts import access
from apps.accounts.models import Profile
from apps.events.models import Event, Registration
from apps.events.views import PUBLIC_STATUSES
from apps.events.views import ROLE as EVENT_ROLE
from apps.integrations import calendar, service
from apps.integrations.models import Connection, EventLink
from apps.integrations.providers import PROVIDERS, ProviderError
from apps.notifications import emails, ticket


def _ics(event, *, with_link: bool) -> HttpResponse:
    response = HttpResponse(calendar.build(event, with_link=with_link), content_type="text/calendar; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{event.slug}.ics"'
    return response


def event_calendar(request, slug):
    """GET /api/events/<slug>/calendar.ics: the public invite, without the meeting link."""
    event = get_object_or_404(Event.objects.select_related("organization"), slug=slug, status__in=PUBLIC_STATUSES)
    return _ics(event, with_link=False)


def ticket_calendar(request, ticket_code):
    """GET /api/tickets/<code>/calendar.ics: the invite for someone registered, with the link.

    The ticket code is the secret here, as it is on the ticket itself, so a calendar app can
    fetch it without signing in.
    """
    registration = get_object_or_404(
        Registration.objects.select_related("event__organization"), ticket_code=ticket_code
    )
    if registration.event.status not in PUBLIC_STATUSES:
        raise Http404
    return _ics(registration.event, with_link=registration.status == Registration.Status.REGISTERED)


def ticket_pdf(request, ticket_code):
    """GET /api/tickets/<code>/ticket.pdf: the printable ticket. The code is the secret."""
    registration = get_object_or_404(
        Registration.objects.select_related("event__organization", "profile"),
        ticket_code=ticket_code, status=Registration.Status.REGISTERED,
    )
    response = HttpResponse(ticket.build(registration), content_type="application/pdf")
    response["Content-Disposition"] = f'inline; filename="{ticket.filename(registration)}"'
    return response


# --- connected accounts (Google, Microsoft, Zoom) -------------------------------------



def _provider(provider_id):
    if provider_id not in PROVIDERS:
        raise NotFound("Unknown service.")
    return PROVIDERS[provider_id]


PLATFORM_NAME = "A Million Techies"


def _usable_orgs(request) -> dict:
    """{organisation id: name} for the organisations whose apps this member may connect to."""
    from amt_auth.django.models import Organization

    ids = (
        access.managed_org_ids(request, access.Role.EVENT_ORGANISER)
        | access.managed_org_ids(request, access.Role.HACKATHON_MANAGER)
    )
    return dict(Organization.objects.filter(deleted_at=None, id__in=ids).values_list("id", "name"))


def _app_entry(provider, app, app_name, connections):
    connection = connections.get((provider.id, app))
    return {
        "id": provider.id,
        "name": provider.name,
        "app": app,
        "app_name": app_name,
        "meeting_name": provider.meeting_name,
        "has_calendar": provider.has_calendar,
        "configured": provider.configured(app),
        "connected": connection is not None,
        "account_email": connection.account_email if connection else "",
    }


class IntegrationsView(APIView):
    """GET: each service and app you can connect, whether it is set up, and whether you did.

    The platform's app is listed for everyone; an organisation's own app is listed for the
    people who run its events. With ?organization=<id>, just the apps that organisation's
    events use.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        connections = {
            (c.provider, c.organization_id): c
            for c in Connection.objects.filter(profile=access.profile_of(request))
        }
        orgs = _usable_orgs(request)
        wanted = request.query_params.get("organization")
        entries = []
        for provider in PROVIDERS.values():
            if wanted:
                app = provider.app_for(wanted)
                entries.append(_app_entry(provider, app, orgs.get(app, PLATFORM_NAME) if app else PLATFORM_NAME, connections))
                continue
            entries.append(_app_entry(provider, None, PLATFORM_NAME, connections))
            for org_id, name in orgs.items():
                if provider.app_for(org_id) == org_id:
                    entries.append(_app_entry(provider, org_id, name, connections))
        return Response(entries)


class ConnectView(APIView):
    """POST {app}: where to send the browser to connect the account. DELETE ?app=: disconnect."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, provider_id):
        provider = _provider(provider_id)
        app = request.data.get("app") or None
        if app and app not in _usable_orgs(request):
            raise PermissionDenied("You do not run events for that organisation.")
        if not provider.configured(app):
            raise ValidationError(f"{provider.name} is not set up yet. An admin can add it on the Configuration page.")
        state = service.make_state(access.profile_of(request), provider.id, app)
        return Response({"authorize_url": provider.authorize_url(state, app)})

    def delete(self, request, provider_id):
        _provider(provider_id)
        Connection.objects.filter(
            profile=access.profile_of(request), provider=provider_id,
            organization_id=request.query_params.get("app") or None,
        ).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def oauth_callback(request, provider_id):
    """The provider sends the browser back here. Store the account, then return to the console."""
    provider = _provider(provider_id)
    back = f"{settings.COMMUNITY_URL}/manage/integrations"
    if request.GET.get("error"):
        return redirect(f"{back}?error={provider.id}")
    try:
        profile_id, app = service.read_state(request.GET.get("state", ""), provider.id)
        profile = Profile.objects.get(pk=profile_id)
        service.connect(profile, provider.id, request.GET.get("code", ""), app)
    except (signing.BadSignature, Profile.DoesNotExist, ProviderError):
        return redirect(f"{back}?error={provider.id}")
    return redirect(f"{back}?connected={provider.id}")


# --- an event's copies elsewhere ----------------------------------------------------------


def _managed_event(request, slug):
    event = get_object_or_404(Event.objects.select_related("organization"), slug=slug)
    if not access.can_manage(request, event.organization_id, EVENT_ROLE):
        raise PermissionDenied("You do not organise this event.")
    return event


def _link_data(link):
    provider = PROVIDERS[link.connection.provider]
    return {
        "id": link.id,
        "provider": provider.id,
        "provider_name": provider.name,
        "account_email": link.connection.account_email,
        "is_meeting": link.is_meeting,
        "join_url": link.join_url,
        "mine": True,
        "synced_at": link.synced_at,
    }


class EventLinksView(APIView):
    """GET the event's copies; POST {provider, meeting} to add one through your account."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, slug):
        event = _managed_event(request, slug)
        profile = access.profile_of(request)
        links = EventLink.objects.filter(event=event).select_related("connection")
        return Response([{**_link_data(l), "mine": l.connection.profile_id == profile.pk} for l in links])

    def post(self, request, slug):
        event = _managed_event(request, slug)
        provider = _provider(request.data.get("provider", ""))
        meeting = bool(request.data.get("meeting"))
        if meeting and not provider.meeting_name:
            raise ValidationError(f"{provider.name} cannot make meetings.")
        if not meeting and not provider.has_calendar:
            raise ValidationError(f"{provider.name} has no calendar to add events to.")
        if event.status == Event.Status.CANCELLED:
            raise ValidationError("This event is cancelled.")
        connection = service.connection_for(access.profile_of(request), provider.id, event.organization_id)
        if connection is None:
            raise ValidationError(f"Connect your {provider.name} account first.")
        before = emails.snapshot(event)
        try:
            link = service.link_event(connection, event, meeting=meeting)
        except ProviderError as error:
            raise ValidationError(str(error)) from None
        if link.is_meeting:
            emails.event_changed(event, before)
        return Response(_link_data(link), status=status.HTTP_201_CREATED)


class EventLinkView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, slug, link_id):
        event = _managed_event(request, slug)
        link = get_object_or_404(EventLink.objects.select_related("connection", "event"), pk=link_id, event=event)
        if link.connection.profile_id != access.profile_of(request).pk:
            raise PermissionDenied("Only the organiser who added this can remove it.")
        try:
            service.unlink_event(link)
        except ProviderError as error:
            raise ValidationError(str(error)) from None
        return Response(status=status.HTTP_204_NO_CONTENT)
