from django.core import mail
from django.urls import reverse
from model_bakery import baker

from apps.accounts.models import Position, RoleAssignment
from apps.invitations.models import Invitation
from tests.conftest import sign_in

Role = RoleAssignment.Role


def url(name, org, **kwargs):
    return reverse(name, kwargs={"organization_id": org.id, **kwargs})


def roles_of(client, org):
    return sorted(RoleAssignment.objects.filter(profile=client.profile, organization=org).values_list("role", flat=True))


def test_admins_set_up_the_committee_and_invite_someone_new_to_chair_it(admin, bob, anonymous, org):
    assert bob.get(url("positions", org)).status_code == 403
    committee = admin.post(url("positions-committee", org)).json()
    assert [p["title"] for p in committee] == [
        "Chairperson", "Vice chairperson", "Secretary", "Organising secretary", "Treasurer",
    ]
    chair = committee[0]
    assert chair["roles"] == [Role.EVENT_ORGANISER, Role.HACKATHON_MANAGER]

    invited = admin.post(url("position-invite", org, pk=chair["id"]), {"email": "newchair@example.com"}, format="json")
    assert invited.json()["invitation"]["name"] == "newchair@example.com"
    assert mail.outbox[-1].subject == "Alice invited you to be Chairperson of JKUAT"

    newchair = sign_in("newchair")
    newchair.post(reverse("invitation-accept", kwargs={"token": Invitation.objects.get().token}))
    assert roles_of(newchair, org) == [Role.EVENT_ORGANISER, Role.HACKATHON_MANAGER]
    listed = admin.get(url("positions", org)).json()[0]
    assert (listed["holder"]["name"], listed["holder_email"], listed["invitation"]) == ("Newchair", "newchair@example.com", None)
    again = admin.post(url("position-invite", org, pk=chair["id"]), {"email": "newchair@example.com"}, format="json")
    assert again.json() == {"email": "They already hold this position."}

    # The public page shows filled, public positions only.
    Position.objects.filter(title="Treasurer").update(holder=bob.profile, is_public=False)
    page = anonymous.get(reverse("organization-page", kwargs={"alias": "jkuat"})).json()
    assert (page["name"], [(p["title"], p["person"]["name"]) for p in page["leadership"]]) == (
        "JKUAT", [("Chairperson", "Newchair")],
    )


def test_roles_follow_the_position(admin, bob, org):
    secretary = baker.make(Position, organization=org, title="Secretary", roles=[Role.EVENT_ORGANISER])
    chair = baker.make(Position, organization=org, title="Chair", roles=[Role.EVENT_ORGANISER])
    baker.make(RoleAssignment, profile=bob.profile, organization=org, role=Role.HACKATHON_MANAGER)  # given directly
    position = url("position", org, pk=secretary.id)
    invitation = baker.make(Invitation, kind=Invitation.Kind.POSITION, email="bob@example.com", organization=org, position=secretary)
    bob.post(reverse("invitation-accept", kwargs={"token": invitation.token}))
    assert roles_of(bob, org) == [Role.EVENT_ORGANISER, Role.HACKATHON_MANAGER]

    assert admin.patch(position, {"roles": ["owner"]}, format="json").json() == {
        "roles": ["Choose roles from event organiser and hackathon manager."]
    }
    admin.patch(position, {"roles": [Role.HACKATHON_MANAGER, Role.HACKATHON_MANAGER]}, format="json")
    assert Position.objects.get(pk=secretary.pk).roles == [Role.HACKATHON_MANAGER]
    assert roles_of(bob, org) == [Role.HACKATHON_MANAGER]  # the direct grant stays

    # Two positions granting one role: vacating either keeps it while the other does.
    admin.patch(position, {"roles": [Role.EVENT_ORGANISER]}, format="json")
    chair_invite = baker.make(Invitation, kind=Invitation.Kind.POSITION, email="bob@example.com", organization=org, position=chair)
    bob.post(reverse("invitation-accept", kwargs={"token": chair_invite.token}))
    assert admin.post(url("position-vacate", org, pk=secretary.id)).json()["holder"] is None
    assert roles_of(bob, org) == [Role.EVENT_ORGANISER, Role.HACKATHON_MANAGER]
    assert admin.delete(url("position", org, pk=chair.id)).status_code == 204
    assert roles_of(bob, org) == [Role.HACKATHON_MANAGER]
    assert str(secretary) == "Secretary, JKUAT"


def test_admins_add_their_own_positions_and_withdraw_invitations(admin, org):
    created = admin.post(url("positions", org), {"title": "Patron", "roles": [], "is_public": False}, format="json").json()
    assert (created["title"], created["order"], created["is_public"]) == ("Patron", 0, False)
    vacant = admin.patch(url("position", org, pk=created["id"]), {"roles": [Role.EVENT_ORGANISER]}, format="json")
    assert vacant.json()["roles"] == [Role.EVENT_ORGANISER]
    admin.post(url("position-invite", org, pk=created["id"]), {"email": "pat@example.com"}, format="json")
    invitation = Invitation.objects.get()
    assert admin.delete(reverse("sent-invitation", kwargs={"pk": invitation.id})).status_code == 204
    assert admin.get(url("positions", org)).json()[0]["invitation"] is None
