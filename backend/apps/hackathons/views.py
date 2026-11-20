from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.accounts import access
from apps.accounts.views import find_profile_by_email
from apps.hackathons.models import (
    Challenge,
    Criterion,
    Evaluation,
    Hackathon,
    Judge,
    Score,
    Submission,
    Team,
    TeamMember,
)
from apps.hackathons.scoring import leaderboard
from apps.hackathons.serializers import (
    AddJudgeSerializer,
    ChallengeSerializer,
    CreateTeamSerializer,
    CriterionSerializer,
    EvaluationInputSerializer,
    EvaluationSerializer,
    HackathonSerializer,
    JoinTeamSerializer,
    JudgeSerializer,
    MyTeamSerializer,
    SubmissionSerializer,
    TeamSerializer,
    TransitionSerializer,
)

ROLE = access.Role.HACKATHON_MANAGER
Status = Hackathon.Status
PUBLIC_STATUSES = [Status.PUBLISHED, Status.JUDGING, Status.COMPLETED, Status.CANCELLED]
TRANSITIONS = {
    Status.DRAFT: {Status.PUBLISHED},
    Status.PUBLISHED: {Status.JUDGING, Status.CANCELLED},
    Status.JUDGING: {Status.COMPLETED, Status.CANCELLED},
    Status.COMPLETED: set(),
    # Restoring: back to where it was cancelled from (checked in `transition`).
    Status.CANCELLED: {Status.PUBLISHED, Status.JUDGING},
}


def visible_hackathons(request):
    """Published hackathons for everyone; drafts only for the organization's managers."""
    hackathons = Hackathon.objects.select_related("organization").annotate(
        team_count=Count("teams", distinct=True),
        participant_count=Count("participants", distinct=True),
        submission_count=Count("teams__submission", distinct=True),
    ).order_by("-starts_at", "-id")
    if access.is_platform_admin(request):
        return hackathons
    return hackathons.filter(
        Q(status__in=PUBLIC_STATUSES)
        | Q(organization_id__in=access.managed_org_ids(request, ROLE))
    )


def hackathon_context(request, hackathons) -> dict:
    """Per-request lookups the HackathonSerializer needs, fetched once for a list."""
    context = {"managed_org_ids": set(), "judging_ids": set(), "my_teams": {}}
    profile = access.profile_of(request)
    if profile is None:
        return context
    ids = [h.id for h in hackathons]
    if access.is_platform_admin(request):
        context["managed_org_ids"] = {h.organization_id for h in hackathons}
    else:
        context["managed_org_ids"] = access.managed_org_ids(request, ROLE)
    context["judging_ids"] = set(
        Judge.objects.filter(profile=profile, hackathon__in=ids).values_list(
            "hackathon_id", flat=True
        )
    )
    context["my_teams"] = dict(
        TeamMember.objects.filter(profile=profile, hackathon__in=ids).values_list(
            "hackathon_id", "team_id"
        )
    )
    return context


class HackathonViewSet(viewsets.ModelViewSet):
    lookup_field = "slug"
    serializer_class = HackathonSerializer
    filterset_fields = ["organization", "status"]
    search_fields = ["title", "tagline", "theme", "description"]
    ordering_fields = ["starts_at", "created_at"]

    def get_queryset(self):
        hackathons = visible_hackathons(self.request).prefetch_related("challenges", "criteria")
        scope = self.request.query_params.get("scope")
        profile = access.profile_of(self.request)
        if scope == "mine":
            # Hackathons the member takes part in or judges.
            if profile is None:
                return hackathons.none()
            mine = TeamMember.objects.filter(profile=profile).values("hackathon_id")
            judging = Judge.objects.filter(profile=profile).values("hackathon_id")
            hackathons = hackathons.filter(Q(id__in=mine) | Q(id__in=judging))
        elif scope == "managed" and not access.is_platform_admin(self.request):
            hackathons = hackathons.filter(
                organization_id__in=access.managed_org_ids(self.request, ROLE)
            )
        return hackathons

    def get_serializer_context(self):
        return {**super().get_serializer_context(), **getattr(self, "_hackathon_context", {})}

    def _with_context(self, hackathons):
        self._hackathon_context = hackathon_context(self.request, hackathons)

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        self._with_context(page)
        return self.get_paginated_response(self.get_serializer(page, many=True).data)

    def get_object(self):
        hackathon = super().get_object()
        self._with_context([hackathon])
        return hackathon

    # --- who is asking ---------------------------------------------------

    def _can_manage(self, hackathon) -> bool:
        return access.can_manage(self.request, hackathon.organization_id, ROLE)

    def _manageable(self):
        hackathon = self.get_object()
        access.require_manage(self.request, hackathon.organization_id, ROLE)
        return hackathon

    def _judge(self, hackathon):
        profile = access.profile_of(self.request)
        return hackathon.judges.filter(profile=profile).first() if profile else None

    def _my_membership(self, hackathon):
        membership = (
            TeamMember.objects.filter(hackathon=hackathon, profile=access.profile_of(self.request))
            .select_related("team")
            .first()
        )
        if membership is None:
            raise NotFound("You are not in a team for this hackathon.")
        return membership

    def _my_team_response(self, team, status_code=status.HTTP_200_OK):
        team = Team.objects.prefetch_related("members__profile").get(pk=team.pk)
        return Response(MyTeamSerializer(team).data, status=status_code)

    # --- the hackathon itself --------------------------------------------

    def perform_create(self, serializer):
        access.require_manage(self.request, serializer.validated_data["organization_id"], ROLE)
        hackathon = serializer.save(created_by=access.profile_of(self.request))
        hackathon.team_count = hackathon.participant_count = hackathon.submission_count = 0
        self._with_context([hackathon])
        serializer.context.update(self._hackathon_context)

    def perform_update(self, serializer):
        access.require_manage(self.request, serializer.instance.organization_id, ROLE)
        serializer.save()

    def perform_destroy(self, hackathon):
        access.require_manage(self.request, hackathon.organization_id, ROLE)
        if hackathon.status != Status.DRAFT:
            raise ValidationError("Only drafts can be deleted. Cancel a published hackathon instead.")
        hackathon.delete()

    @action(detail=True, methods=["post"])
    def transition(self, request, slug=None):
        """Publish, start judging, publish the results (complete), cancel, or restore a cancelled one."""
        hackathon = self._manageable()
        data = TransitionSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        target = data.validated_data["status"]
        if target not in TRANSITIONS[hackathon.status]:
            raise ValidationError(
                f"A hackathon that is {hackathon.get_status_display().lower()} cannot become {target}."
            )
        if hackathon.status == Status.CANCELLED:
            restore_to = hackathon.cancelled_from or Status.PUBLISHED
            if target != restore_to:
                raise ValidationError(
                    f"This hackathon was cancelled while {Status(restore_to).label.lower()}, "
                    "so it can only be restored to that."
                )
        elif target == Status.JUDGING and not hackathon.criteria.exists():
            raise ValidationError("Add at least one judging criterion before judging starts.")
        hackathon.cancelled_from = hackathon.status if target == Status.CANCELLED else ""
        hackathon.status = target
        hackathon.save(update_fields=["status", "cancelled_from", "updated_at"])
        return Response(self.get_serializer(hackathon).data)

    # --- teams -----------------------------------------------------------

    def _require_free_to_join(self, hackathon, profile):
        if not hackathon.registration_open:
            raise ValidationError("Registration for this hackathon is closed.")
        if hackathon.judges.filter(profile=profile).exists():
            raise ValidationError("Judges cannot take part in the hackathon they judge.")
        if hackathon.participants.filter(profile=profile).exists():
            raise ValidationError("You are already in a team for this hackathon.")

    @action(detail=True, methods=["get", "post"])
    def teams(self, request, slug=None):
        """GET lists the teams. POST registers the member by creating a team they lead."""
        hackathon = self.get_object()
        if request.method == "GET":
            teams = hackathon.teams.prefetch_related("members__profile").select_related(
                "submission"
            )
            return Response(TeamSerializer(teams, many=True).data)
        profile = access.profile_of(request)
        data = CreateTeamSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        self._require_free_to_join(hackathon, profile)
        try:
            with transaction.atomic():
                team = Team.objects.create(hackathon=hackathon, name=data.validated_data["name"])
                TeamMember.objects.create(
                    team=team, hackathon=hackathon, profile=profile, is_leader=True
                )
        except IntegrityError as exc:
            raise ValidationError({"name": "A team with this name already exists."}) from exc
        return self._my_team_response(team, status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="teams/join")
    def join_team(self, request, slug=None):
        """Join a team with the invite code its leader shared."""
        hackathon = self.get_object()
        profile = access.profile_of(request)
        data = JoinTeamSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        self._require_free_to_join(hackathon, profile)
        with transaction.atomic():
            team = (
                Team.objects.select_for_update()
                .filter(hackathon=hackathon, invite_code=data.validated_data["invite_code"])
                .first()
            )
            if team is None:
                raise ValidationError({"invite_code": "No team has this invite code."})
            if team.members.count() >= hackathon.max_team_size:
                raise ValidationError("This team is full.")
            TeamMember.objects.create(team=team, hackathon=hackathon, profile=profile)
        return self._my_team_response(team, status.HTTP_201_CREATED)

    @action(
        detail=True, methods=["get"], url_path="my-team",
        permission_classes=[permissions.IsAuthenticated],
    )
    def my_team(self, request, slug=None):
        return self._my_team_response(self._my_membership(self.get_object()).team)

    @action(detail=True, methods=["post"], url_path="my-team/leave")
    def leave_team(self, request, slug=None):
        """Leave the team. Leadership passes on; an empty team is removed."""
        hackathon = self.get_object()
        membership = self._my_membership(hackathon)
        if hackathon.status != Status.PUBLISHED:
            raise ValidationError("Teams are fixed once judging starts.")
        team = membership.team
        with transaction.atomic():
            membership.delete()
            successor = team.members.first()
            if successor is None:
                team.delete()
            elif membership.is_leader:
                successor.is_leader = True
                successor.save(update_fields=["is_leader"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["delete"], url_path=r"my-team/members/(?P<member_id>\d+)")
    def remove_member(self, request, slug=None, member_id=None):
        hackathon = self.get_object()
        membership = self._my_membership(hackathon)
        if not membership.is_leader:
            raise PermissionDenied("Only the team leader removes members.")
        if hackathon.status != Status.PUBLISHED:
            raise ValidationError("Teams are fixed once judging starts.")
        member = get_object_or_404(membership.team.members, id=member_id)
        if member.id == membership.id:
            raise ValidationError("To go yourself, leave the team.")
        member.delete()
        return self._my_team_response(membership.team)

    # --- submissions and judging ------------------------------------------

    @action(detail=True, methods=["put"], url_path="my-team/submission")
    def submit(self, request, slug=None):
        """Create or update the team's project submission, until the deadline."""
        hackathon = self.get_object()
        team = self._my_membership(hackathon).team
        if not hackathon.submissions_open:
            raise ValidationError("Submissions for this hackathon are closed.")
        if team.members.count() < hackathon.min_team_size:
            raise ValidationError(
                f"Teams need at least {hackathon.min_team_size} members to submit."
            )
        data = SubmissionSerializer(
            getattr(team, "submission", None), data=request.data, context={"hackathon": hackathon}
        )
        data.is_valid(raise_exception=True)
        data.save(team=team)
        return self._my_team_response(team)

    @action(detail=True, methods=["get"])
    def submissions(self, request, slug=None):
        """Managers and judges see submissions; everyone does once results are published."""
        hackathon = self.get_object()
        judge = self._judge(hackathon)
        if not (hackathon.results_published or judge or self._can_manage(hackathon)):
            raise PermissionDenied("Projects are shown once the results are published.")
        submissions = (
            Submission.objects.filter(team__hackathon=hackathon)
            .select_related("team", "challenge")
            .prefetch_related("team__members__profile")
        )
        mine = {}
        if judge:
            evaluations = judge.evaluations.prefetch_related("scores")
            mine = {e.submission_id: EvaluationSerializer(e).data for e in evaluations}
        return Response(
            [
                {
                    **SubmissionSerializer(s).data,
                    "members": [m.profile.display_name for m in s.team.members.all()],
                    "my_evaluation": mine.get(s.id),
                }
                for s in submissions
            ]
        )

    @action(detail=True, methods=["put"], url_path=r"submissions/(?P<submission_id>\d+)/evaluation")
    def evaluate(self, request, slug=None, submission_id=None):
        """A judge scores a submission against every criterion. Can be revised while judging."""
        hackathon = self.get_object()
        judge = self._judge(hackathon)
        if judge is None:
            raise PermissionDenied("Only this hackathon's judges score submissions.")
        if hackathon.status != Status.JUDGING:
            raise ValidationError("Scoring is open only while the hackathon is being judged.")
        submission = get_object_or_404(Submission, id=submission_id, team__hackathon=hackathon)
        data = EvaluationInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        criteria = {c.id: c for c in hackathon.criteria.all()}
        given = {s["criterion"]: s["value"] for s in data.validated_data["scores"]}
        if set(given) != set(criteria):
            raise ValidationError({"scores": "Give one score for every criterion."})
        for criterion_id, value in given.items():
            if value > criteria[criterion_id].max_score:
                raise ValidationError(
                    {"scores": f"{criteria[criterion_id].name} is out of "
                               f"{criteria[criterion_id].max_score}."}
                )
        with transaction.atomic():
            evaluation, _ = Evaluation.objects.update_or_create(
                submission=submission, judge=judge,
                defaults={"comment": data.validated_data["comment"]},
            )
            evaluation.scores.all().delete()
            Score.objects.bulk_create(
                Score(evaluation=evaluation, criterion_id=c, value=v) for c, v in given.items()
            )
        return Response(EvaluationSerializer(evaluation).data)

    @action(detail=True, methods=["get"])
    def leaderboard(self, request, slug=None):
        """Rankings: for managers at any time, for everyone once results are published."""
        hackathon = self.get_object()
        if not (hackathon.results_published or self._can_manage(hackathon)):
            raise PermissionDenied("The leaderboard is shown once the results are published.")
        judges = hackathon.judges.count()
        return Response(
            [
                {
                    "rank": row["rank"],
                    "score": row["score"],
                    "evaluations": row["evaluations"],
                    "judges": judges,
                    "submission": SubmissionSerializer(row["submission"]).data,
                }
                for row in leaderboard(hackathon)
            ]
        )

    @action(detail=True, methods=["get", "post"])
    def judges(self, request, slug=None):
        hackathon = self._manageable()
        if request.method == "POST":
            data = AddJudgeSerializer(data=request.data)
            data.is_valid(raise_exception=True)
            profile = find_profile_by_email(data.validated_data["email"])
            if hackathon.participants.filter(profile=profile).exists():
                raise ValidationError({"email": "This member takes part in the hackathon."})
            Judge.objects.get_or_create(hackathon=hackathon, profile=profile)
        judges = hackathon.judges.select_related("profile")
        return Response(JudgeSerializer(judges, many=True).data)

    @action(detail=True, methods=["delete"], url_path=r"judges/(?P<judge_id>\d+)")
    def remove_judge(self, request, slug=None, judge_id=None):
        hackathon = self._manageable()
        get_object_or_404(hackathon.judges, id=judge_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class HackathonChildViewSet(
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Challenges and criteria. They are read as part of the hackathon; managers write them."""

    permission_classes = [permissions.IsAuthenticated]
    model = None
    locked_message = ""

    def _hackathon(self):
        hackathon = get_object_or_404(
            visible_hackathons(self.request), slug=self.kwargs["hackathon_slug"]
        )
        access.require_manage(self.request, hackathon.organization_id, ROLE)
        if self.locked(hackathon):
            raise ValidationError(self.locked_message)
        return hackathon

    def locked(self, hackathon) -> bool:
        return False

    def get_queryset(self):
        return self.model.objects.filter(hackathon=self._hackathon())

    def perform_create(self, serializer):
        serializer.save(hackathon=self._hackathon())


class ChallengeViewSet(HackathonChildViewSet):
    model = Challenge
    serializer_class = ChallengeSerializer


class CriterionViewSet(HackathonChildViewSet):
    model = Criterion
    serializer_class = CriterionSerializer
    locked_message = "Criteria are fixed once judging starts."

    def locked(self, hackathon) -> bool:
        return hackathon.status not in (Status.DRAFT, Status.PUBLISHED)
