from django.contrib import admin

from apps.accounts.models import Profile, RoleAssignment


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ["full_name", "email", "institution", "created_at"]
    search_fields = ["full_name", "email"]


@admin.register(RoleAssignment)
class RoleAssignmentAdmin(admin.ModelAdmin):
    list_display = ["profile", "role", "organization"]
    list_filter = ["role"]
