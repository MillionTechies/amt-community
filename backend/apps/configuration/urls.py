from django.urls import path

from apps.configuration import views

urlpatterns = [
    path("configuration/", views.ScopesView.as_view()),
    path("configuration/<str:scope>/", views.ConfigurationView.as_view()),
    path("configuration/<str:scope>/test-email/", views.TestEmailView.as_view()),
]
