from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.hackathons import views

router = DefaultRouter()
router.register("hackathons", views.HackathonViewSet, basename="hackathon")

collection = {"post": "create"}
item = {"patch": "partial_update", "delete": "destroy"}
prefix = "hackathons/<slug:hackathon_slug>"

urlpatterns = router.urls + [
    path("join/", views.join_by_code, name="join"),
    path(f"{prefix}/challenges/", views.ChallengeViewSet.as_view(collection), name="hackathon-challenges"),
    path(f"{prefix}/challenges/<int:pk>/", views.ChallengeViewSet.as_view(item), name="hackathon-challenge"),
    path(f"{prefix}/criteria/", views.CriterionViewSet.as_view(collection), name="hackathon-criteria"),
    path(f"{prefix}/criteria/<int:pk>/", views.CriterionViewSet.as_view(item), name="hackathon-criterion"),
    path(f"{prefix}/announcements/", views.AnnouncementViewSet.as_view({"get": "list", "post": "create"}), name="hackathon-announcements"),
    path(f"{prefix}/announcements/<int:pk>/", views.AnnouncementViewSet.as_view({"delete": "destroy"}), name="hackathon-announcement"),
]
