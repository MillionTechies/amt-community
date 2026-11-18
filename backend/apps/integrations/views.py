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


class IntegrationsView(APIView):
    """GET: each service, whether it is set up on this server, and whether you connected it."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        mine = {c.provider: c for c in Connection.objects.filter(profile=access.profile_of(request))}
        return Response([
            {
                "id": p.id,
                "name": p.name,
                "meeting_name": p.meeting_name,
                "has_calendar": p.has_calendar,
                "configured": p.configured,
                "connected": p.id in mine,
                "account_email": mine[p.id].account_email if p.id in mine else "",
            }
            for p in PROVIDERS.values()
        ])


class ConnectView(APIView):
    """POST: where to send the browser to connect the account. DELETE: disconnect it."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, provider_id):
        provider = _provider(provider_id)
        if not provider.configured:
            raise ValidationError(f"{provider.name} is not set up on this server yet.")
        state = service.make_state(access.profile_of(request), provider.id)
        return Response({"authorize_url": provider.authorize_url(state)})

    def delete(self, request, provider_id):
        _provider(provider_id)
        Connection.objects.filter(profile=access.profile_of(request), provider=provider_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def oauth_callback(request, provider_id):
    """The provider sends the browser back here. Store the account, then return to the console."""
    provider = _provider(provider_id)
    back = f"{settings.COMMUNITY_URL}/manage/integrations"
    if request.GET.get("error"):
        return redirect(f"{back}?error={provider.id}")
    try:
        profile = Profile.objects.get(pk=service.read_state(request.GET.get("state", ""), provider.id))
        service.connect(profile, provider.id, request.GET.get("code", ""))
    except (signing.BadSignature, Profile.DoesNotExist):
        return redirect(f"{back}?error={provider.id}")
    except ProviderError:
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
        connection = Connection.objects.filter(profile=access.profile_of(request), provider=provider.id).first()
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
