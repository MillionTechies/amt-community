from django.contrib import admin

from apps.events.models import Announcement, Event, Feedback, Registration, Resource


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ["title", "organization", "event_type", "status", "starts_at"]
    list_filter = ["status", "event_type", "delivery_mode"]
    search_fields = ["title"]


@admin.register(Registration)
class RegistrationAdmin(admin.ModelAdmin):
    list_display = ["profile", "event", "status", "checked_in_at"]
    list_filter = ["status"]


admin.site.register([Announcement, Resource, Feedback])
