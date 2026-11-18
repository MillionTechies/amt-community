from django.urls import path

from apps.platform_admin import views

urlpatterns = [
    path("platform/overview/", views.OverviewView.as_view()),
    path("platform/organizations/", views.OrganizationsView.as_view()),
    path("platform/organizations/<str:organization_id>/", views.OrganizationDetailView.as_view()),
    path("platform/members/", views.MembersView.as_view()),
    path("platform/emails/", views.EmailsView.as_view()),
]
