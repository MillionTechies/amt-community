from django.urls import path

from apps.integrations import views

urlpatterns = [
    path("events/<slug:slug>/calendar.ics", views.event_calendar, name="event-calendar"),
    path("tickets/<uuid:ticket_code>/calendar.ics", views.ticket_calendar, name="ticket-calendar"),
    path("tickets/<uuid:ticket_code>/ticket.pdf", views.ticket_pdf, name="ticket-pdf"),
    path("events/<slug:slug>/links/", views.EventLinksView.as_view(), name="event-links"),
    path("events/<slug:slug>/links/<int:link_id>/", views.EventLinkView.as_view(), name="event-link"),
    path("integrations/", views.IntegrationsView.as_view(), name="integrations"),
    path("integrations/<str:provider_id>/", views.ConnectView.as_view(), name="integration"),
    path("integrations/<str:provider_id>/callback/", views.oauth_callback, name="integration-callback"),
]
