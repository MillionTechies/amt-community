from django.db import models


class Profile(models.Model):
    """A member of the community.

    Identity lives in Keycloak; `sub` is the Keycloak user ID. The row is created
    the first time the user calls the API and holds what Community itself knows.
    """

    sub = models.CharField(primary_key=True, max_length=64)
    email = models.EmailField(blank=True, db_index=True)
    full_name = models.CharField(max_length=255, blank=True)
    headline = models.CharField(max_length=160, blank=True)
    bio = models.TextField(blank=True)
    institution = models.CharField(max_length=255, blank=True)
    skills = models.JSONField(default=list, blank=True)
    github_url = models.URLField(blank=True)
    linkedin_url = models.URLField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return self.full_name or self.email or self.sub

    @property
    def display_name(self) -> str:
        return self.full_name or self.email.split("@")[0] or "Member"


class RoleAssignment(models.Model):
    """A role an organization's admin grants to a member, scoped to that organization.

    Platform admins (Keycloak realm role) and organization admins (the
    organization's `/admins` group) come from the token and are not stored here.
    """

    class Role(models.TextChoices):
        EVENT_ORGANISER = "event_organiser", "Event organiser"
        HACKATHON_MANAGER = "hackathon_manager", "Hackathon manager"

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="roles")
    organization = models.ForeignKey(
        "amt_auth.Organization", on_delete=models.CASCADE, related_name="role_assignments"
    )
    role = models.CharField(max_length=32, choices=Role.choices)
    granted_by = models.ForeignKey(
        Profile, on_delete=models.SET_NULL, null=True, related_name="roles_granted"
    )
    # Set when the role comes with a position (see `positions`), so vacating it takes the role away.
    position = models.ForeignKey(
        "Position", on_delete=models.SET_NULL, null=True, blank=True, related_name="granted_roles"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["profile", "organization", "role"], name="unique_role_assignment"
            )
        ]

    def __str__(self) -> str:
        return f"{self.profile} is {self.get_role_display()} at {self.organization}"


class Position(models.Model):
    """An office in an organization's leadership: Chairperson, Secretary, Treasurer, or its own.

    A position can carry roles, which its holder gets while they hold it. Public positions
    show on the organization's page, so members know who runs it.
    """

    organization = models.ForeignKey(
        "amt_auth.Organization", on_delete=models.CASCADE, related_name="positions"
    )
    title = models.CharField(max_length=100)
    order = models.PositiveSmallIntegerField(default=0)
    # RoleAssignment.Role values the holder gets.
    roles = models.JSONField(default=list, blank=True)
    holder = models.ForeignKey(
        Profile, on_delete=models.SET_NULL, null=True, blank=True, related_name="positions"
    )
    is_public = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self) -> str:
        return f"{self.title}, {self.organization}"


class OrganizationApplication(models.Model):
    """A request to bring an organization onto Community.

    Any member can apply for their university, company, tech community or group. A
    platform admin reviews it; approving creates the organization in Keycloak and
    makes the applicant its first admin (see `onboarding.provision`).
    """

    class Kind(models.TextChoices):
        INSTITUTION = "institution", "University, college or school"
        COMPANY = "company", "Company"
        COMMUNITY = "community", "Tech community"
        GROUP = "group", "Club or student group"
        NONPROFIT = "nonprofit", "Non-profit or foundation"
        OTHER = "other", "Something else"

    class Status(models.TextChoices):
        PENDING = "pending", "Waiting for review"
        APPROVED = "approved", "Approved"
        DECLINED = "declined", "Declined"

    applicant = models.ForeignKey(
        Profile, on_delete=models.CASCADE, related_name="organization_applications"
    )
    name = models.CharField(max_length=255)
    kind = models.CharField(max_length=20, choices=Kind.choices)
    website = models.URLField(blank=True)
    location = models.CharField(max_length=255, blank=True)
    about = models.TextField()
    plans = models.TextField(blank=True)
    contact_phone = models.CharField(max_length=40, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    review_note = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(
        Profile, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    # The Keycloak organization created on approval. Saved as soon as Keycloak
    # answers, so an approval that fails part-way can be retried without a duplicate.
    keycloak_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.name} ({self.get_status_display()})"
