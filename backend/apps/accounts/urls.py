from django.urls import path

from apps.accounts import views

positions = "organizations/<str:organization_id>/positions"

urlpatterns = [
    path(f"{positions}/", views.PositionViewSet.as_view({"get": "list", "post": "create"}), name="positions"),
    path(f"{positions}/committee/", views.PositionViewSet.as_view({"post": "committee"}), name="positions-committee"),
    path(
        f"{positions}/<int:pk>/",
        views.PositionViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="position",
    ),
    path(f"{positions}/<int:pk>/invite/", views.PositionViewSet.as_view({"post": "invite"}), name="position-invite"),
    path(f"{positions}/<int:pk>/vacate/", views.PositionViewSet.as_view({"post": "vacate"}), name="position-vacate"),
    path("organizations/<str:alias>/page/", views.OrganizationPageView.as_view(), name="organization-page"),
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
