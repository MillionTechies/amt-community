from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.events import views

router = DefaultRouter()
router.register("events", views.EventViewSet, basename="event")

collection = {"get": "list", "post": "create"}
item = {"delete": "destroy"}

urlpatterns = router.urls + [
    path("events/<int:event_pk>/announcements/", views.AnnouncementViewSet.as_view(collection)),
    path("events/<int:event_pk>/announcements/<int:pk>/", views.AnnouncementViewSet.as_view(item)),
    path("events/<int:event_pk>/resources/", views.ResourceViewSet.as_view(collection)),
    path("events/<int:event_pk>/resources/<int:pk>/", views.ResourceViewSet.as_view(item)),
    path("certificates/<uuid:code>/", views.verify_certificate),
]
