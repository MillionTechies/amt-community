from django.contrib import admin

from apps.hackathons import models


@admin.register(models.Hackathon)
class HackathonAdmin(admin.ModelAdmin):
    list_display = ["title", "organization", "status", "starts_at"]
    list_filter = ["status"]
    search_fields = ["title"]


admin.site.register(
    [models.Challenge, models.Criterion, models.Team, models.TeamMember, models.Submission,
     models.Judge, models.Evaluation, models.Score, models.Announcement]
)
