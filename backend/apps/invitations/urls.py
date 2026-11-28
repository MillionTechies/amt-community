from django.urls import path

from apps.invitations import views

urlpatterns = [
    path("me/invitations/", views.MyInvitationsView.as_view(), name="my-invitations"),
    path("invitations/sent/<int:pk>/", views.SentInvitationView.as_view(), name="sent-invitation"),
    path("invitations/<str:token>/", views.InvitationView.as_view(), name="invitation"),
    path("invitations/<str:token>/accept/", views.RespondView.as_view(answer="accept"), name="invitation-accept"),
    path("invitations/<str:token>/decline/", views.RespondView.as_view(answer="decline"), name="invitation-decline"),
]
