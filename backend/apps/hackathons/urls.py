from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.hackathons import views

router = DefaultRouter()
router.register("hackathons", views.HackathonViewSet, basename="hackathon")

collection = {"post": "create"}
item = {"patch": "partial_update", "delete": "destroy"}
prefix = "hackathons/<slug:hackathon_slug>"

urlpatterns = router.urls + [
    path(f"{prefix}/challenges/", views.ChallengeViewSet.as_view(collection)),
    path(f"{prefix}/challenges/<int:pk>/", views.ChallengeViewSet.as_view(item)),
    path(f"{prefix}/criteria/", views.CriterionViewSet.as_view(collection)),
    path(f"{prefix}/criteria/<int:pk>/", views.CriterionViewSet.as_view(item)),
    path(f"{prefix}/announcements/", views.AnnouncementViewSet.as_view({"get": "list", "post": "create"})),
    path(f"{prefix}/announcements/<int:pk>/", views.AnnouncementViewSet.as_view({"delete": "destroy"})),
]
