from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404

from apps.events.models import Event, Registration
from apps.events.views import PUBLIC_STATUSES
from apps.integrations import calendar


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
