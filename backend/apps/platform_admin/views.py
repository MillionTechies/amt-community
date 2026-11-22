"""The platform admin's view of the whole community: every organisation, member, event and email.

Read-only summaries, plus retrying a failed email and reviewing organisation applications.
Only platform admins (realm role `admin`).
"""

from datetime import timedelta

from amt_auth.django.models import Membership, Organization
from amt_auth.django.permissions import IsPlatformAdmin
from amt_auth.exceptions import AdminAPIError
from django.db.models import Count, Max, Q
from django.shortcuts import get_object_or_404
from django.core.validators import validate_slug
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts import access, onboarding
from apps.accounts.models import OrganizationApplication, Profile, RoleAssignment
from apps.configuration import config
from apps.configuration.registry import GROUPS
from apps.events.models import Event, Registration
from apps.hackathons.models import Hackathon, Submission, TeamMember
from apps.integrations.providers import PROVIDERS
from apps.notifications import emails, sender
from apps.notifications.models import OutboundEmail

ADMINS_GROUP = "/admins"


def _status_counts(queryset) -> dict:
    return dict(queryset.values_list("status").annotate(n=Count("id")).values_list("status", "n"))


def _own_apps(org_id) -> list[str]:
    """Which of the Google, Microsoft and Zoom apps an organisation set up itself."""
    return [p.name for p in PROVIDERS.values() if p.app_for(org_id) == org_id]


class OverviewView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        now = timezone.now()
        month_ago = now - timedelta(days=30)
        live_orgs = Organization.objects.filter(deleted_at=None)
        registrations = Registration.objects.exclude(status=Registration.Status.CANCELLED)
        outbound = OutboundEmail.objects.all()

        attention = []
        orgs_without_admins = live_orgs.exclude(
            memberships__group__path=ADMINS_GROUP, memberships__deleted_at=None
        ).distinct()
        for org in orgs_without_admins[:10]:
            attention.append({"kind": "organization", "title": f"{org.name} has no admin", "detail": "Add someone to its admins group in Keycloak.", "link": f"/platform/organizations/{org.id}"})
        pending = OrganizationApplication.objects.filter(status=OrganizationApplication.Status.PENDING).count()
        if pending:
            attention.append({"kind": "application", "title": f"{pending} {'organisation is' if pending == 1 else 'organisations are'} waiting to join", "detail": "Review their applications.", "link": "/platform/applications"})
        failed = outbound.filter(status=OutboundEmail.Status.FAILED).count()
        if failed:
            attention.append({"kind": "email", "title": f"{failed} {'email' if failed == 1 else 'emails'} could not be sent", "detail": "Check the email settings, then retry them.", "link": "/platform/emails"})
        stale = Event.objects.filter(status=Event.Status.PUBLISHED, ends_at__lt=now).count()
        if stale:
            attention.append({"kind": "event", "title": f"{stale} finished {'event is' if stale == 1 else 'events are'} not marked completed", "detail": "Their attendees cannot get certificates yet.", "link": "/manage/events"})
        if not config.get("email.host"):
            attention.append({"kind": "config", "title": "Email is not set up", "detail": "Add an SMTP server so confirmations and reminders go out.", "link": "/platform/configuration"})
        unset = [p.name for p in PROVIDERS.values() if not p.configured()]
        if unset:
            attention.append({"kind": "config", "title": f"{', '.join(unset)} not set up", "detail": "Organisers can still paste meeting links by hand.", "link": "/platform/configuration"})

        recent_events = Event.objects.select_related("organization").order_by("-created_at")[:6]
        return Response({
            "totals": {
                "organizations": live_orgs.count(),
                "members": Profile.objects.count(),
                "new_members_30d": Profile.objects.filter(created_at__gte=month_ago).count(),
                "organisers": RoleAssignment.objects.values("profile").distinct().count()
                + Membership.objects.filter(group__path=ADMINS_GROUP, deleted_at=None).values("user_sub").distinct().count(),
                "events": Event.objects.count(),
                "upcoming_events": Event.objects.filter(status=Event.Status.PUBLISHED, ends_at__gte=now).count(),
                "hackathons": Hackathon.objects.count(),
                "active_hackathons": Hackathon.objects.filter(status__in=[Hackathon.Status.PUBLISHED, Hackathon.Status.JUDGING]).count(),
                "registrations": registrations.count(),
                "check_ins": Registration.objects.exclude(checked_in_at=None).count(),
                "hackers": TeamMember.objects.values("profile").distinct().count(),
                "projects": Submission.objects.count(),
            },
            "events_by_status": _status_counts(Event.objects),
            "hackathons_by_status": _status_counts(Hackathon.objects),
            "emails": {
                "sent_30d": outbound.filter(status=OutboundEmail.Status.SENT, sent_at__gte=month_ago).count(),
                "queued": outbound.filter(status__in=[OutboundEmail.Status.QUEUED, OutboundEmail.Status.SENDING]).count(),
                "failed": failed,
            },
            # One timestamp per registration in the last 30 days, for the sign-ups chart.
            "registrations_30d": [
                d.isoformat() for d in Registration.objects.filter(created_at__gte=month_ago).values_list("created_at", flat=True)
            ],
            "recent_events": [
                {"slug": e.slug, "title": e.title, "organization": e.organization.name, "status": e.status, "starts_at": e.starts_at, "created_at": e.created_at}
                for e in recent_events
            ],
            "attention": attention,
        })


def _org_rows(orgs):
    now = timezone.now()
    ids = [o.id for o in orgs]
    members = dict(
        Membership.objects.filter(organization_id__in=ids, deleted_at=None)
        .values_list("organization_id").annotate(n=Count("user_sub", distinct=True)).values_list("organization_id", "n")
    )
    admins = dict(
        Membership.objects.filter(organization_id__in=ids, deleted_at=None, group__path=ADMINS_GROUP)
        .values_list("organization_id").annotate(n=Count("user_sub", distinct=True)).values_list("organization_id", "n")
    )
    roles = dict(
        RoleAssignment.objects.filter(organization_id__in=ids)
        .values_list("organization_id").annotate(n=Count("profile", distinct=True)).values_list("organization_id", "n")
    )
    events = {
        row["organization_id"]: row
        for row in Event.objects.filter(organization_id__in=ids).values("organization_id").annotate(
            total=Count("id"),
            upcoming=Count("id", filter=Q(status=Event.Status.PUBLISHED, ends_at__gte=now)),
            last=Max("starts_at"),
        )
    }
    registrations = dict(
        Registration.objects.filter(event__organization_id__in=ids).exclude(status=Registration.Status.CANCELLED)
        .values_list("event__organization_id").annotate(n=Count("id")).values_list("event__organization_id", "n")
    )
    hackathons = dict(
        Hackathon.objects.filter(organization_id__in=ids)
        .values_list("organization_id").annotate(n=Count("id")).values_list("organization_id", "n")
    )
    return [
        {
            "id": o.id,
            "name": o.name,
            "alias": o.alias,
            "members": members.get(o.id, 0),
            "admins": admins.get(o.id, 0),
            "organisers": roles.get(o.id, 0),
            "events": events.get(o.id, {}).get("total", 0),
            "upcoming_events": events.get(o.id, {}).get("upcoming", 0),
            "last_event_at": events.get(o.id, {}).get("last"),
            "hackathons": hackathons.get(o.id, 0),
            "registrations": registrations.get(o.id, 0),
            "own_apps": _own_apps(o.id),
            "synced_at": o.synced_at,
        }
        for o in orgs
    ]


class OrganizationsView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        return Response(_org_rows(list(Organization.objects.filter(deleted_at=None).order_by("name"))))


class OrganizationDetailView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request, organization_id):
        org = get_object_or_404(Organization, id=organization_id, deleted_at=None)
        admin_subs = Membership.objects.filter(
            organization=org, deleted_at=None, group__path=ADMINS_GROUP
        ).values_list("user_sub", flat=True)
        people = {p.sub: p for p in Profile.objects.filter(sub__in=list(admin_subs))}
        roles = RoleAssignment.objects.filter(organization=org).select_related("profile")
        events = Event.objects.filter(organization=org).annotate(
            registered=Count("registrations", filter=Q(registrations__status=Registration.Status.REGISTERED))
        ).order_by("-starts_at")[:50]
        hackathons = Hackathon.objects.filter(organization=org).order_by("-starts_at")[:50]
        overrides = [
            {"group": g.title, "keys": [f.label for f in g.fields if config.lookup(f.key, org.id)[1] == "organization"]}
            for g in GROUPS
        ]
        return Response({
            **_org_rows([org])[0],
            "admin_people": [
                {"sub": sub, "name": people[sub].full_name if sub in people else "Has not signed in yet", "email": people[sub].email if sub in people else ""}
                for sub in admin_subs
            ],
            "role_people": [
                {"name": r.profile.full_name, "email": r.profile.email, "role": r.role} for r in roles
            ],
            "event_list": [
                {"slug": e.slug, "title": e.title, "status": e.status, "starts_at": e.starts_at, "registered": e.registered}
                for e in events
            ],
            "hackathon_list": [
                {"slug": h.slug, "title": h.title, "status": h.status, "starts_at": h.starts_at} for h in hackathons
            ],
            "overrides": [o for o in overrides if o["keys"]],
        })


class MembersView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        profiles = Profile.objects.annotate(
            registrations=Count("event_registrations", filter=~Q(event_registrations__status=Registration.Status.CANCELLED), distinct=True),
            attended=Count("event_registrations", filter=Q(event_registrations__checked_in_at__isnull=False), distinct=True),
        ).order_by("-created_at")
        memberships = {}
        for sub, name, path in Membership.objects.filter(deleted_at=None).values_list("user_sub", "organization__name", "group__path"):
            entry = memberships.setdefault(sub, {})
            entry[name] = entry.get(name) or path == ADMINS_GROUP
        roles = {}
        for sub, role, org in RoleAssignment.objects.values_list("profile_id", "role", "organization__name"):
            roles.setdefault(sub, []).append(f"{role.replace('_', ' ')} at {org}")
        return Response([
            {
                "sub": p.sub,
                "name": p.full_name,
                "email": p.email,
                "institution": p.institution,
                "joined": p.created_at,
                "organizations": [
                    {"name": name, "admin": is_admin} for name, is_admin in sorted(memberships.get(p.sub, {}).items())
                ],
                "roles": roles.get(p.sub, []),
                "registrations": p.registrations,
                "attended": p.attended,
            }
            for p in profiles
        ])


class EmailsView(APIView):
    """The latest emails and how they went. POST {"ids": [...]} (or "failed": true) retries."""

    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        latest = OutboundEmail.objects.select_related("event").order_by("-created_at")[:500]
        return Response([
            {
                "id": e.id, "kind": e.kind, "to": e.to, "subject": e.subject, "status": e.status,
                "attempts": e.attempts, "last_error": e.last_error, "created_at": e.created_at,
                "sent_at": e.sent_at, "event": e.event.title if e.event_id else "",
            }
            for e in latest
        ])

    def post(self, request):
        failed = OutboundEmail.objects.filter(status=OutboundEmail.Status.FAILED)
        if not request.data.get("failed"):
            failed = failed.filter(id__in=request.data.get("ids") or [])
        ids = list(failed.values_list("id", flat=True))
        failed.update(status=OutboundEmail.Status.QUEUED, attempts=0, last_error="")
        sender.deliver(ids)
        return Response({"retried": len(ids)})


def _application_row(a: OrganizationApplication) -> dict:
    return {
        "id": a.id, "name": a.name, "kind": a.kind, "kind_label": a.get_kind_display(),
        "website": a.website, "location": a.location, "about": a.about, "plans": a.plans,
        "contact_phone": a.contact_phone, "status": a.status, "review_note": a.review_note,
        "applicant": {"sub": a.applicant_id, "name": a.applicant.full_name, "email": a.applicant.email, "institution": a.applicant.institution},
        "reviewed_by": a.reviewed_by.full_name if a.reviewed_by_id else "",
        "reviewed_at": a.reviewed_at, "created_at": a.created_at, "organization_id": a.keycloak_id,
        "suggested_alias": onboarding.suggest_alias(a.name) if a.status == OrganizationApplication.Status.PENDING else "",
    }


class ApplicationsView(APIView):
    """Every application to bring an organisation onto Community, newest first."""

    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        applications = OrganizationApplication.objects.select_related("applicant", "reviewed_by")
        return Response([_application_row(a) for a in applications])


class _Approve(serializers.Serializer):
    alias = serializers.CharField(max_length=60, validators=[validate_slug])
    note = serializers.CharField(required=False, allow_blank=True, default="")


class _Decline(serializers.Serializer):
    note = serializers.CharField()


TAKEN = "Keycloak already has an organisation with this name or alias. Pick another alias."
KEYCLOAK_DOWN = "Keycloak could not create the organisation. Try again in a moment."


def _decide(application, decision: str, *, alias: str, note: str, reviewer) -> None:
    """Approve (creating the organisation in Keycloak) or decline one pending application, and email the applicant."""
    if decision == "approve":
        try:
            onboarding.provision(application, alias)
        except AdminAPIError as exc:
            if exc.status_code == onboarding.ALREADY_EXISTS:
                raise ValidationError({"alias": TAKEN}) from exc
            error = APIException(KEYCLOAK_DOWN)
            error.status_code = 502
            raise error from exc
        application.status = OrganizationApplication.Status.APPROVED
    else:
        application.status = OrganizationApplication.Status.DECLINED
    application.review_note = note.strip()
    application.reviewed_by = reviewer
    application.reviewed_at = timezone.now()
    application.save()
    if decision == "approve":
        emails.application_approved(application)
    else:
        emails.application_declined(application)


def _pending():
    return OrganizationApplication.objects.select_related("applicant").filter(
        status=OrganizationApplication.Status.PENDING
    )


class ApplicationReviewView(APIView):
    """POST .../approve/ {"alias", "note"?} creates the organisation; .../decline/ {"note"} turns it down."""

    permission_classes = [IsPlatformAdmin]

    def post(self, request, application_id, decision):
        application = get_object_or_404(_pending(), id=application_id)
        data = (_Approve if decision == "approve" else _Decline)(data=request.data)
        data.is_valid(raise_exception=True)
        _decide(
            application, decision, alias=data.validated_data.get("alias", "").lower(),
            note=data.validated_data["note"], reviewer=access.profile_of(request),
        )
        return Response(_application_row(application))


class _Bulk(serializers.Serializer):
    ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=False, max_length=100)
    decision = serializers.ChoiceField(choices=["approve", "decline"])
    note = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, data):
        if data["decision"] == "decline" and data["note"].strip() == "":
            raise ValidationError({"note": "Give a reason. It is emailed to every applicant."})
        return data


class ApplicationBulkReviewView(APIView):
    """POST {"ids", "decision", "note"} decides many at once. Approvals use each one's suggested alias.

    One failing (a taken name, Keycloak down) does not stop the others; it is reported back.
    """

    permission_classes = [IsPlatformAdmin]

    def post(self, request):
        data = _Bulk(data=request.data)
        data.is_valid(raise_exception=True)
        decision, note = data.validated_data["decision"], data.validated_data["note"]
        done, failed = [], []
        for application in _pending().filter(id__in=data.validated_data["ids"]).order_by("created_at"):
            try:
                _decide(
                    application, decision, alias=onboarding.suggest_alias(application.name),
                    note=note, reviewer=access.profile_of(request),
                )
                done.append(application.id)
            except ValidationError:
                failed.append({"id": application.id, "name": application.name, "error": "Its name or alias is taken in Keycloak. Open it to pick another alias."})
            except APIException:
                failed.append({"id": application.id, "name": application.name, "error": KEYCLOAK_DOWN})
        return Response({"done": done, "failed": failed})
