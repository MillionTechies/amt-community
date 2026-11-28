from amt_auth.django.models import Organization
from rest_framework import serializers

from apps.accounts.serializers import OrganizationSerializer, PersonSerializer, TeammateSerializer, initials
from apps.content import richtext
from apps.hackathons.models import (
    Announcement,
    Challenge,
    Criterion,
    Evaluation,
    Hackathon,
    Judge,
    Participant,
    Submission,
    Team,
    TeamMember,
)

MAX_PRIZES = 20


class ChallengeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Challenge
        fields = ["id", "title", "description"]


class CriterionSerializer(serializers.ModelSerializer):
    max_score = serializers.IntegerField(min_value=1, max_value=100, default=10)
    weight = serializers.IntegerField(min_value=1, max_value=100, default=1)

    class Meta:
        model = Criterion
        fields = ["id", "name", "description", "max_score", "weight"]


class HackathonSerializer(serializers.ModelSerializer):
    organization = OrganizationSerializer(read_only=True)
    organization_id = serializers.CharField(write_only=True)
    challenges = ChallengeSerializer(many=True, read_only=True)
    criteria = CriterionSerializer(many=True, read_only=True)
    team_count = serializers.IntegerField(read_only=True)
    participant_count = serializers.IntegerField(read_only=True)
    submission_count = serializers.IntegerField(read_only=True)
    registration_open = serializers.BooleanField(read_only=True)
    submissions_open = serializers.BooleanField(read_only=True)
    results_published = serializers.BooleanField(read_only=True)
    can_manage = serializers.SerializerMethodField()
    is_judge = serializers.SerializerMethodField()
    my_team_id = serializers.SerializerMethodField()
    is_registered = serializers.SerializerMethodField()
    join_code = serializers.SerializerMethodField()
    my_scores = serializers.SerializerMethodField()
    participant_preview = serializers.SerializerMethodField()

    class Meta:
        model = Hackathon
        fields = [
            "slug", "organization", "organization_id", "title", "tagline", "cover_image", "description", "theme",
            "rules", "eligibility", "prizes", "venue", "starts_at", "ends_at",
            "registration_deadline", "submission_deadline", "min_team_size", "max_team_size",
            "status", "cancelled_from", "challenges", "criteria", "team_count", "participant_count",
            "submission_count", "registration_open", "submissions_open", "results_published",
            "can_manage", "is_judge", "my_team_id", "is_registered", "join_code", "my_scores", "listed",
            "participant_preview", "created_at",
        ]
        read_only_fields = ["status", "cancelled_from", "created_at"]

    def get_participant_preview(self, hackathon) -> list[str]:
        """Initials of the first few people taking part, for the faces on a card."""
        # Prefetched by visible_hackathons; a just-created hackathon has nobody yet.
        return [initials(m.profile.full_name) for m in getattr(hackathon, "preview_participants", [])]

    def validate_prizes(self, value):
        """A list of {title, value}; rows left completely empty are dropped."""
        if not isinstance(value, list):
            raise serializers.ValidationError("Send prizes as a list.")
        prizes = []
        for row in value:
            if not isinstance(row, dict):
                raise serializers.ValidationError("Each prize needs a title and a value.")
            title = str(row.get("title") or "").strip()
            amount = str(row.get("value") or "").strip()
            if not title and not amount:
                continue
            if not title:
                raise serializers.ValidationError("Give every prize a title, such as Winner.")
            if len(title) > 100 or len(amount) > 100:
                raise serializers.ValidationError("Keep prize titles and values under 100 characters.")
            prizes.append({"title": title, "value": amount})
        if len(prizes) > MAX_PRIZES:
            raise serializers.ValidationError(f"A hackathon can list at most {MAX_PRIZES} prizes.")
        return prizes

    def validate_description(self, value):
        return richtext.clean(value)

    def get_can_manage(self, hackathon) -> bool:
        return hackathon.organization_id in self.context.get("managed_org_ids", ())

    def get_is_judge(self, hackathon) -> bool:
        return hackathon.id in self.context.get("judging_ids", ())

    def get_my_team_id(self, hackathon) -> int | None:
        return self.context.get("my_teams", {}).get(hackathon.id)

    def get_is_registered(self, hackathon) -> bool:
        return hackathon.id in self.context.get("registered_ids", ())

    def get_join_code(self, hackathon) -> str | None:
        """The 6-digit code is the managers' to share."""
        return hackathon.join_code if self.get_can_manage(hackathon) else None

    def get_my_scores(self, hackathon) -> int | None:
        """How many projects the member has scored, when they judge this hackathon."""
        return self.context.get("judge_scored", {}).get(hackathon.id, 0) if self.get_is_judge(hackathon) else None

    def validate_organization_id(self, value):
        if not Organization.objects.filter(id=value, deleted_at=None).exists():
            raise serializers.ValidationError("Unknown organisation.")
        return value

    def validate(self, attrs):
        def current(name):
            return attrs.get(name, getattr(self.instance, name, None))

        starts, ends = current("starts_at"), current("ends_at")
        registration, submission = current("registration_deadline"), current("submission_deadline")
        if starts and ends and ends <= starts:
            raise serializers.ValidationError({"ends_at": "The hackathon must end after it starts."})
        if registration and submission and registration > submission:
            raise serializers.ValidationError(
                {"registration_deadline": "Registration must close before submissions do."}
            )
        if starts and submission and submission < starts:
            raise serializers.ValidationError(
                {"submission_deadline": "Submissions cannot close before the hackathon starts."}
            )
        low, high = current("min_team_size") or 1, current("max_team_size") or 4
        if low < 1 or high < low:
            raise serializers.ValidationError(
                {"max_team_size": "The largest team must be at least as big as the smallest."}
            )
        if self.instance and attrs.get("organization_id", self.instance.organization_id) != (
            self.instance.organization_id
        ):
            raise serializers.ValidationError(
                {"organization_id": "A hackathon cannot move to another organisation."}
            )
        return attrs


class TeamMemberSerializer(serializers.ModelSerializer):
    person = TeammateSerializer(source="profile", read_only=True)

    class Meta:
        model = TeamMember
        fields = ["id", "person", "is_leader", "joined_at"]


class SubmissionSerializer(serializers.ModelSerializer):
    challenge = ChallengeSerializer(read_only=True)
    challenge_id = serializers.PrimaryKeyRelatedField(
        source="challenge", queryset=Challenge.objects.all(), allow_null=True, required=False,
        write_only=True,
    )
    team_name = serializers.CharField(source="team.name", read_only=True)

    class Meta:
        model = Submission
        fields = [
            "id", "team_name", "challenge", "challenge_id", "title", "description",
            "repository_url", "demo_url", "video_url", "submitted_at", "updated_at",
        ]

    def validate_challenge_id(self, challenge):
        if challenge and challenge.hackathon_id != self.context["hackathon"].id:
            raise serializers.ValidationError("This challenge belongs to another hackathon.")
        return challenge


class TeamSerializer(serializers.ModelSerializer):
    members = TeamMemberSerializer(many=True, read_only=True)
    has_submission = serializers.SerializerMethodField()
    spots_left = serializers.SerializerMethodField()

    class Meta:
        model = Team
        fields = ["id", "name", "members", "has_submission", "is_open", "spots_left", "created_at"]

    def get_has_submission(self, team) -> bool:
        return hasattr(team, "submission")

    def get_spots_left(self, team) -> int:
        return max(0, team.hackathon.max_team_size - len(team.members.all()))


class TeamSettingsSerializer(serializers.ModelSerializer):
    """What a leader changes about their team."""

    class Meta:
        model = Team
        fields = ["name", "is_open"]


class MyTeamSerializer(TeamSerializer):
    """The team as its own members see it, with the invite code and submission."""

    submission = serializers.SerializerMethodField()

    class Meta(TeamSerializer.Meta):
        fields = TeamSerializer.Meta.fields + ["invite_code", "submission"]

    def get_submission(self, team):
        return SubmissionSerializer(team.submission).data if hasattr(team, "submission") else None


class CreateTeamSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)


class JoinTeamSerializer(serializers.Serializer):
    invite_code = serializers.CharField(max_length=24)


class JoinByCodeSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=20)

    def validate_code(self, value):
        # People paste "482 913" or "482-913".
        code = "".join(ch for ch in value if ch.isdigit())
        if len(code) != 6:
            raise serializers.ValidationError("Enter the 6-digit code.")
        return code


class RegistrationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Participant
        fields = ["id", "looking_for_team", "registered_at"]


class ParticipantSerializer(serializers.ModelSerializer):
    """Someone registered, as fellow participants and managers see them."""

    person = TeammateSerializer(source="profile", read_only=True)
    team_name = serializers.SerializerMethodField()

    class Meta:
        model = Participant
        fields = ["id", "person", "looking_for_team", "team_name", "registered_at"]

    def get_team_name(self, participant) -> str | None:
        return self.context["teams"].get(participant.profile_id)


class JudgeSerializer(serializers.ModelSerializer):
    person = PersonSerializer(source="profile", read_only=True)
    email = serializers.EmailField(source="profile.email", read_only=True)
    evaluations = serializers.IntegerField(source="evaluations.count", read_only=True)

    class Meta:
        model = Judge
        fields = ["id", "person", "email", "evaluations", "created_at"]


class AddJudgeSerializer(serializers.Serializer):
    email = serializers.EmailField()


class ScoreInputSerializer(serializers.Serializer):
    criterion = serializers.IntegerField()
    value = serializers.IntegerField(min_value=0)


class EvaluationInputSerializer(serializers.Serializer):
    scores = ScoreInputSerializer(many=True)
    comment = serializers.CharField(allow_blank=True, required=False, default="")


class EvaluationSerializer(serializers.ModelSerializer):
    scores = serializers.SerializerMethodField()

    class Meta:
        model = Evaluation
        fields = ["id", "comment", "scores", "updated_at"]

    def get_scores(self, evaluation):
        return [{"criterion": s.criterion_id, "value": s.value} for s in evaluation.scores.all()]


class TransitionSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Hackathon.Status.choices)


class AnnouncementSerializer(serializers.ModelSerializer):
    # Write-only: also email every team member and judge. The reply says how many were emailed.
    notify = serializers.BooleanField(write_only=True, required=False, default=False)
    emailed_to = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = Announcement
        fields = ["id", "title", "body", "created_at", "notify", "emailed_to"]

    def validate_body(self, value):
        return richtext.clean(value)
