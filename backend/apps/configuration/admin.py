from django.contrib import admin

from apps.configuration.models import Setting


@admin.register(Setting)
class SettingAdmin(admin.ModelAdmin):
    list_display = ["key", "organization", "updated_by", "updated_at"]
    list_filter = ["key"]
    # Values may be secrets (stored encrypted); change them on the Configuration page.
    exclude = ["value"]
    readonly_fields = ["organization", "key", "updated_by", "updated_at"]
