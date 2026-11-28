"""Filling and vacating an organization's positions, with the roles that come with them.

Roles a position grants are linked to it (RoleAssignment.position), so vacating the
position takes back exactly those. A role the person already had another way is left
alone, and a role two of their positions grant stays while either does.
"""

from django.db import transaction

from apps.accounts.models import Position, RoleAssignment

# The committee most clubs and communities have, for "Add the usual committee".
COMMITTEE = [
    ("Chairperson", [RoleAssignment.Role.EVENT_ORGANISER, RoleAssignment.Role.HACKATHON_MANAGER]),
    ("Vice chairperson", [RoleAssignment.Role.EVENT_ORGANISER, RoleAssignment.Role.HACKATHON_MANAGER]),
    ("Secretary", [RoleAssignment.Role.EVENT_ORGANISER]),
    ("Organising secretary", [RoleAssignment.Role.EVENT_ORGANISER]),
    ("Treasurer", []),
]


def _grant(position, granted_by=None) -> None:
    for role in position.roles:
        RoleAssignment.objects.get_or_create(
            profile=position.holder, organization=position.organization, role=role,
            defaults={"position": position, "granted_by": granted_by},
        )


def _regrant_others(profile, organization) -> None:
    """Give back what the person's other positions still grant."""
    for other in Position.objects.filter(holder=profile, organization=organization):
        _grant(other)


def vacate(position) -> None:
    holder = position.holder
    with transaction.atomic():
        position.granted_roles.all().delete()
        position.holder = None
        position.save(update_fields=["holder"])
        if holder:
            _regrant_others(holder, position.organization)


def fill(position, profile, granted_by=None) -> None:
    with transaction.atomic():
        vacate(position)
        position.holder = profile
        position.save(update_fields=["holder"])
        _grant(position, granted_by)


def sync_roles(position) -> None:
    """After the position's roles change, its holder's roles follow."""
    with transaction.atomic():
        position.granted_roles.exclude(role__in=position.roles).delete()
        if position.holder:
            _grant(position)
            _regrant_others(position.holder, position.organization)


def add_committee(organization) -> list[Position]:
    start = Position.objects.filter(organization=organization).count()
    return Position.objects.bulk_create(
        Position(organization=organization, title=title, roles=list(roles), order=start + i)
        for i, (title, roles) in enumerate(COMMITTEE)
    )
