from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts import access
from apps.invitations import services
from apps.invitations.models import Invitation, mask
from apps.invitations.serializers import InvitationSerializer, PublicInvitationSerializer

RELATED = ["organization", "position", "hackathon", "team", "invited_by"]


def _public(request, invitation):
    return Response(PublicInvitationSerializer(invitation, context={"profile": access.profile_of(request)}).data)


class InvitationView(APIView):
    """The page the email links to: anyone with the link sees what the invitation is for."""

    permission_classes = [permissions.AllowAny]

    def get(self, request, token):
        return _public(request, get_object_or_404(Invitation.objects.select_related(*RELATED), token=token))


class RespondView(APIView):
    """The invited person accepts or declines, signed in with the address it was sent to."""

    permission_classes = [permissions.IsAuthenticated]
    answer = "accept"

    def post(self, request, token):
        invitation = get_object_or_404(Invitation.objects.select_related(*RELATED), token=token)
        profile = access.profile_of(request)
        if profile.email.lower() != invitation.email:
            raise PermissionDenied(
                f"This invitation is for {mask(invitation.email)}. Sign in with that account to answer it."
            )
        if self.answer == "accept":
            services.accept(invitation, profile)
        else:
            services.decline(invitation)
        return _public(request, invitation)


class MyInvitationsView(APIView):
    """Invitations waiting for the signed-in member, such as those sent before they joined."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        invitations = Invitation.objects.select_related(*RELATED).filter(
            email=access.profile_of(request).email.lower(), status=Invitation.Status.PENDING
        )
        context = {"profile": access.profile_of(request)}
        return Response(PublicInvitationSerializer(invitations, many=True, context=context).data)


class SentInvitationView(APIView):
    """Whoever may send an invitation can withdraw it (DELETE) or send it again (POST)."""

    permission_classes = [permissions.IsAuthenticated]

    def _invitation(self, request, pk):
        invitation = get_object_or_404(Invitation.objects.select_related(*RELATED), pk=pk)
        if not services.can_administer(request, invitation):
            raise PermissionDenied("You cannot change this invitation.")
        return invitation

    def delete(self, request, pk):
        services.revoke(self._invitation(request, pk))
        return Response(status=status.HTTP_204_NO_CONTENT)

    def post(self, request, pk):
        invitation = self._invitation(request, pk)
        if invitation.status != Invitation.Status.PENDING:
            raise ValidationError("Only invitations still waiting for an answer can be sent again.")
        services.send(invitation)
        return Response(InvitationSerializer(invitation).data)
