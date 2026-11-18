from django.urls import path

from apps.content.views import UploadView

urlpatterns = [path("uploads/", UploadView.as_view())]
