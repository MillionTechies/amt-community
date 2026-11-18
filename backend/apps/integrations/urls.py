from django.urls import path

from apps.integrations import views

urlpatterns = [
    path("events/<slug:slug>/calendar.ics", views.event_calendar),
    path("tickets/<uuid:ticket_code>/calendar.ics", views.ticket_calendar),
    path("events/<slug:slug>/links/", views.EventLinksView.as_view()),
    path("events/<slug:slug>/links/<int:link_id>/", views.EventLinkView.as_view()),
    path("integrations/", views.IntegrationsView.as_view()),
    path("integrations/<str:provider_id>/", views.ConnectView.as_view()),
    path("integrations/<str:provider_id>/callback/", views.oauth_callback),
]
