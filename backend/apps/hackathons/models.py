import secrets

from django.db import models
from django.utils import timezone

from apps.accounts.models import Profile
from apps.slugs import MAX_LENGTH, make_slug


def new_invite_code() -> str:
    return secrets.token_urlsafe(9)


class Hackathon(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PUBLISHED = "published", "Open"  # registration, team formation and submissions
        JUDGING = "judging", "Judging"
        COMPLETED = "completed", "Completed"  # results are public
        CANCELLED = "cancelled", "Cancelled"

    organization = models.ForeignKey(
        "amt_auth.Organization", on_delete=models.PROTECT, related_name="hackathons"
    )
    title = models.CharField(max_length=200)
    # The public address; see apps.slugs.
    slug = models.SlugField(max_length=MAX_LENGTH, unique=True, editable=False)
    tagline = models.CharField(max_length=300, blank=True)
    # A banner for lists and the hackathon page: an address from the uploads endpoint.
    cover_image = models.URLField(max_length=500, blank=True)
    description = models.TextField(blank=True)
    theme = models.CharField(max_length=200, blank=True)
    rules = models.TextField(blank=True)
    eligibility = models.TextField(blank=True)
    # In award order: [{"title": "Winner", "value": "KES 60,000"}, ...]
    prizes = models.JSONField(default=list, blank=True)
    venue = models.CharField(max_length=255, blank=True)  # blank: online
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    registration_deadline = models.DateTimeField()
    submission_deadline = models.DateTimeField()
    min_team_size = models.PositiveSmallIntegerField(default=1)  # 1 allows individuals
    max_team_size = models.PositiveSmallIntegerField(default=4)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    # Where a cancelled hackathon was (open or judging), so restoring puts it back there.
    cancelled_from = models.CharField(max_length=20, choices=Status.choices, blank=True)
    created_by = models.ForeignKey(Profile, on_delete=models.SET_NULL, null=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-starts_at"]

    def __str__(self) -> str:
        return self.title

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = make_slug(self.title, Hackathon)
        super().save(*args, **kwargs)

    @property
    def registration_open(self) -> bool:
        return self.status == self.Status.PUBLISHED and timezone.now() < self.registration_deadline

    @property
    def submissions_open(self) -> bool:
        return self.status == self.Status.PUBLISHED and timezone.now() < self.submission_deadline

    @property
    def results_published(self) -> bool:
        return self.status == self.Status.COMPLETED


class Challenge(models.Model):
    """A problem statement or track that teams can build for."""

    hackathon = models.ForeignKey(Hackathon, on_delete=models.CASCADE, related_name="challenges")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return self.title


class Criterion(models.Model):
    """What judges score, e.g. Innovation out of 10 with weight 2."""

    hackathon = models.ForeignKey(Hackathon, on_delete=models.CASCADE, related_name="criteria")
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=300, blank=True)
    max_score = models.PositiveSmallIntegerField(default=10)
    weight = models.PositiveSmallIntegerField(default=1)

    class Meta:
        ordering = ["id"]
        verbose_name_plural = "criteria"

    def __str__(self) -> str:
        return self.name


class Team(models.Model):
    """Participants take part as a team. Someone taking part alone is a team of one."""

    hackathon = models.ForeignKey(Hackathon, on_delete=models.CASCADE, related_name="teams")
    name = models.CharField(max_length=100)
    invite_code = models.CharField(max_length=24, unique=True, default=new_invite_code)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(fields=["hackathon", "name"], name="unique_team_name")
        ]

    def __str__(self) -> str:
        return self.name


class TeamMember(models.Model):
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="members")
    # Repeats team.hackathon so the database can keep a person to one team per hackathon.
    hackathon = models.ForeignKey(Hackathon, on_delete=models.CASCADE, related_name="participants")
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="team_memberships")
    is_leader = models.BooleanField(default=False)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["joined_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["hackathon", "profile"], name="one_team_per_hackathon"
            )
        ]


class Submission(models.Model):
    team = models.OneToOneField(Team, on_delete=models.CASCADE, related_name="submission")
    challenge = models.ForeignKey(
        Challenge, on_delete=models.SET_NULL, null=True, blank=True, related_name="submissions"
    )
    title = models.CharField(max_length=200)
    description = models.TextField()
    repository_url = models.URLField()
    demo_url = models.URLField(blank=True)
    video_url = models.URLField(blank=True)
    submitted_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["submitted_at"]

    def __str__(self) -> str:
        return self.title


class Judge(models.Model):
    hackathon = models.ForeignKey(Hackathon, on_delete=models.CASCADE, related_name="judges")
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="judging")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(fields=["hackathon", "profile"], name="unique_judge")
        ]


class Evaluation(models.Model):
    """One judge's assessment of one submission; the scores hang off it."""

    submission = models.ForeignKey(Submission, on_delete=models.CASCADE, related_name="evaluations")
    judge = models.ForeignKey(Judge, on_delete=models.CASCADE, related_name="evaluations")
    comment = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["submission", "judge"], name="unique_evaluation")
        ]


class Score(models.Model):
    evaluation = models.ForeignKey(Evaluation, on_delete=models.CASCADE, related_name="scores")
    criterion = models.ForeignKey(Criterion, on_delete=models.CASCADE, related_name="scores")
    value = models.PositiveSmallIntegerField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["evaluation", "criterion"], name="unique_score")
        ]


class Announcement(models.Model):
    """News for a hackathon's teams and judges, shown on its page and optionally emailed."""

    hackathon = models.ForeignKey(Hackathon, on_delete=models.CASCADE, related_name="announcements")
    title = models.CharField(max_length=200)
    body = models.TextField()
    created_by = models.ForeignKey(Profile, on_delete=models.SET_NULL, null=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.title
