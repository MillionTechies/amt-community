from django.urls import path

from apps.accounts import views

urlpatterns = [
    path("me/", views.MeView.as_view(), name="me"),
    path("organizations/", views.OrganizationListView.as_view(), name="organizations"),
    path("organizations/applications/", views.OrganizationApplicationsView.as_view(), name="organization-applications"),
    path("organizations/sync/", views.OrganizationSyncView.as_view(), name="organizations-sync"),
    path("organizations/<str:organization_id>/roles/", views.OrganizationRolesView.as_view(), name="organization-roles"),
    path(
        "organizations/<str:organization_id>/invitations/",
        views.OrganizationInvitationsView.as_view(),
        name="organization-invitations",
    ),
    path(
        "organizations/<str:organization_id>/roles/<int:role_id>/",
        views.OrganizationRolesView.as_view(),
        name="organization-role",
    ),
]
