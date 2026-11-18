from django.urls import path

from apps.integrations import views

urlpatterns = [
    path("events/<slug:slug>/calendar.ics", views.event_calendar),
    path("tickets/<uuid:ticket_code>/calendar.ics", views.ticket_calendar),
]
