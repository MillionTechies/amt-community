from django.urls import path

from apps.accounts import views

urlpatterns = [
    path("me/", views.MeView.as_view()),
    path("organizations/", views.OrganizationListView.as_view()),
    path("organizations/applications/", views.OrganizationApplicationsView.as_view()),
    path("organizations/sync/", views.OrganizationSyncView.as_view()),
    path("organizations/<str:organization_id>/roles/", views.OrganizationRolesView.as_view()),
    path(
        "organizations/<str:organization_id>/roles/<int:role_id>/",
        views.OrganizationRolesView.as_view(),
    ),
]
