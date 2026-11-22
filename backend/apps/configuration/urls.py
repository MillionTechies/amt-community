from django.urls import path

from apps.configuration import views

urlpatterns = [
    path("configuration/", views.ScopesView.as_view(), name="configuration-scopes"),
    path("configuration/<str:scope>/", views.ConfigurationView.as_view(), name="configuration"),
    path("configuration/<str:scope>/test-email/", views.TestEmailView.as_view(), name="configuration-test-email"),
]
