from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.events import views

router = DefaultRouter()
router.register("events", views.EventViewSet, basename="event")

collection = {"get": "list", "post": "create"}
item = {"delete": "destroy"}

urlpatterns = router.urls + [
    path("events/<slug:event_slug>/announcements/", views.AnnouncementViewSet.as_view(collection)),
    path("events/<slug:event_slug>/announcements/<int:pk>/", views.AnnouncementViewSet.as_view(item)),
    path("events/<slug:event_slug>/resources/", views.ResourceViewSet.as_view(collection)),
    path("events/<slug:event_slug>/resources/<int:pk>/", views.ResourceViewSet.as_view(item)),
    path("certificates/<uuid:code>/", views.verify_certificate),
]
