from django.contrib import admin

from apps.notifications.models import OutboundEmail


@admin.register(OutboundEmail)
class OutboundEmailAdmin(admin.ModelAdmin):
    list_display = ["created_at", "kind", "to", "subject", "status", "attempts"]
    list_filter = ["status", "kind"]
    search_fields = ["to", "subject"]
    readonly_fields = [f.name for f in OutboundEmail._meta.fields]
