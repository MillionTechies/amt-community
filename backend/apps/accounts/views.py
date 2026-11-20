from amt_auth.django.models import Organization
from amt_auth.django.permissions import IsPlatformAdmin
from amt_auth.exceptions import AdminAPIError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts import access
from apps.accounts.models import Profile, RoleAssignment
from apps.accounts.serializers import (
    GrantRoleSerializer,
    OrganizationSerializer,
    ProfileSerializer,
    RoleAssignmentSerializer,
)
from apps.accounts.sync import locked_sync_all


def find_profile_by_email(email: str) -> Profile:
    profile = Profile.objects.filter(email__iexact=email).first()
    if profile is None:
        raise ValidationError(
            {"email": "No member has this email yet. Ask them to sign in to Community once first."}
        )
    return profile


class MeView(APIView):
    """The signed-in member: profile, organizations and what they may manage."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(self._payload(request))

    def patch(self, request):
        serializer = ProfileSerializer(access.profile_of(request), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(self._payload(request))

    def _payload(self, request):
        claims = access.claims_of(request)
        profile = access.profile_of(request)
        platform_admin = access.is_platform_admin(request)
        # The mirror normally learns of organizations from Keycloak's webhook or
        # `amt_sync`. A token can arrive first, so make sure its organizations exist.
        known = {
            o.id: o for o in Organization.objects.filter(id__in=[m.id for m in claims.memberships])
        }
        for m in claims.memberships:
            if m.id not in known:
                known[m.id] = Organization.objects.create(
                    id=m.id, name=m.alias, alias=m.alias, synced_at=timezone.now()
                )
        roles: dict[str, list[str]] = {}
        for org_id, role in profile.roles.values_list("organization_id", "role"):
            roles.setdefault(org_id, []).append(role)

        def entry(org, is_admin):
            held = roles.get(org.id, [])
            manages_all = is_admin or platform_admin
            return {
                "id": org.id,
                "name": org.name,
                "alias": org.alias,
                "is_admin": manages_all,
                "roles": held,
                "can_manage_events": manages_all or RoleAssignment.Role.EVENT_ORGANISER in held,
                "can_manage_hackathons": manages_all
                or RoleAssignment.Role.HACKATHON_MANAGER in held,
            }

        member_of = {m.id: m for m in claims.memberships}
        organizations = [entry(known[m.id], m.is_admin) for m in claims.memberships]
        # Roles can be granted in organizations the user is not a Keycloak member of.
        extra_ids = set(roles) - set(member_of)
        if platform_admin:
            extra = Organization.objects.filter(deleted_at=None).exclude(id__in=member_of)
        else:
            extra = Organization.objects.filter(deleted_at=None, id__in=extra_ids)
        organizations += [entry(org, False) for org in extra]
        return {
            **ProfileSerializer(profile).data,
            "is_platform_admin": platform_admin,
            "organizations": organizations,
        }


class OrganizationListView(generics.ListAPIView):
    """Organizations on the platform, mirrored from Keycloak."""

    permission_classes = [permissions.AllowAny]
    serializer_class = OrganizationSerializer
    queryset = Organization.objects.filter(deleted_at=None).order_by("name")
    pagination_class = None


class OrganizationSyncView(APIView):
    """Platform admins pull organizations, groups and members from Keycloak now."""

    permission_classes = [IsPlatformAdmin]

    def post(self, request):
        try:
            count = locked_sync_all()
        except AdminAPIError as exc:
            error = APIException("Keycloak request failed.")
            error.status_code = 502
            raise error from exc
        if count is None:
            return Response({"detail": "A sync is already running."}, status=status.HTTP_409_CONFLICT)
        return Response({"organizations": count})


class OrganizationRolesView(APIView):
    """An organization's admins grant and list event organiser and hackathon manager roles."""

    permission_classes = [permissions.IsAuthenticated]

    def _organization(self, request, organization_id):
        organization = get_object_or_404(Organization, id=organization_id, deleted_at=None)
        if not access.is_org_admin(request, organization.id):
            raise PermissionDenied("Only this organisation's admins manage its roles.")
        return organization

    def get(self, request, organization_id):
        organization = self._organization(request, organization_id)
        roles = organization.role_assignments.select_related("profile").order_by("role", "id")
        return Response(RoleAssignmentSerializer(roles, many=True).data)

    def post(self, request, organization_id):
        organization = self._organization(request, organization_id)
        data = GrantRoleSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        profile = find_profile_by_email(data.validated_data["email"])
        assignment, created = RoleAssignment.objects.get_or_create(
            profile=profile,
            organization=organization,
            role=data.validated_data["role"],
            defaults={"granted_by": access.profile_of(request)},
        )
        return Response(
            RoleAssignmentSerializer(assignment).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def delete(self, request, organization_id, role_id):
        organization = self._organization(request, organization_id)
        get_object_or_404(RoleAssignment, id=role_id, organization=organization).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
