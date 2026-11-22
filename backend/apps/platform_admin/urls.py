from django.urls import path

from apps.platform_admin import views

urlpatterns = [
    path("platform/overview/", views.OverviewView.as_view(), name="platform-overview"),
    path("platform/organizations/", views.OrganizationsView.as_view(), name="platform-organizations"),
    path("platform/organizations/<str:organization_id>/", views.OrganizationDetailView.as_view(), name="platform-organization"),
    path("platform/members/", views.MembersView.as_view(), name="platform-members"),
    path("platform/emails/", views.EmailsView.as_view(), name="platform-emails"),
    path("platform/applications/", views.ApplicationsView.as_view(), name="platform-applications"),
    path("platform/applications/bulk/", views.ApplicationBulkReviewView.as_view(), name="platform-applications-bulk"),
    path(
        "platform/applications/<int:application_id>/approve/",
        views.ApplicationReviewView.as_view(),
        {"decision": "approve"},
        name="platform-application-approve",
    ),
    path(
        "platform/applications/<int:application_id>/decline/",
        views.ApplicationReviewView.as_view(),
        {"decision": "decline"},
        name="platform-application-decline",
    ),
]
