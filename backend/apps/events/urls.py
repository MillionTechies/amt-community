from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.events import views

router = DefaultRouter()
router.register("events", views.EventViewSet, basename="event")

collection = {"get": "list", "post": "create"}
item = {"delete": "destroy"}

urlpatterns = router.urls + [
    path("events/<slug:event_slug>/announcements/", views.AnnouncementViewSet.as_view(collection), name="event-announcements"),
    path("events/<slug:event_slug>/announcements/<int:pk>/", views.AnnouncementViewSet.as_view(item), name="event-announcement"),
    path("events/<slug:event_slug>/resources/", views.ResourceViewSet.as_view(collection), name="event-resources"),
    path("events/<slug:event_slug>/resources/<int:pk>/", views.ResourceViewSet.as_view(item), name="event-resource"),
    path("certificates/<uuid:code>/", views.verify_certificate, name="certificate"),
]
