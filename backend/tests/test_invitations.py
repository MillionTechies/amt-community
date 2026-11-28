import pytest
from django.core import mail
from rest_framework.exceptions import ValidationError
from django.urls import reverse
from model_bakery import baker

from apps.accounts.models import RoleAssignment
from apps.hackathons.models import Judge, Participant, TeamMember
from apps.invitations import services
from apps.invitations.models import Invitation
from tests.conftest import sign_in
from tests.test_hackathons import make_hackathon, make_team

Kind = Invitation.Kind


@pytest.fixture
def dan():
    return sign_in("dan")


@pytest.fixture
def judy():
    return sign_in("judy")


def accept(client, invitation):
    return client.post(reverse("invitation-accept", kwargs={"token": invitation.token}))


def test_someone_new_is_invited_signs_up_and_accepts(admin, anonymous, carol, org):
    hackathon = make_hackathon(org)
    admin.post(
        reverse("hackathon-invitations", kwargs={"slug": hackathon.slug}),
        {"kind": "participant", "emails": ["newbie@example.com"]}, format="json",
    )
    invitation = Invitation.objects.get()
    assert mail.outbox[-1].to == ["newbie@example.com"]
    assert mail.outbox[-1].subject == "Alice invited you to take part in Build for Health"
    assert f"/invitations/{invitation.token}" in mail.outbox[-1].body

    # The link works before they have an account, without giving their address away.
    page = anonymous.get(reverse("invitation", kwargs={"token": invitation.token})).json()
    assert (page["email_hint"], page["invited_by"], page["is_for_you"]) == ("n***@example.com", "Alice", False)
    assert page["hackathon"] == {"slug": hackathon.slug, "title": "Build for Health"}
    assert anonymous.post(reverse("invitation-accept", kwargs={"token": invitation.token})).status_code == 401
    assert accept(carol, invitation).json() == {
        "detail": "This invitation is for n***@example.com. Sign in with that account to answer it."
    }

    newbie = sign_in("newbie")  # signed up with the invited address
    assert [i["token"] for i in newbie.get(reverse("my-invitations")).json()] == [invitation.token]
    accepted = accept(newbie, invitation).json()
    assert (accepted["status"], accepted["is_for_you"]) == ("accepted", True)
    assert Participant.objects.filter(hackathon=hackathon, profile=newbie.profile).exists()
    assert newbie.get(reverse("my-invitations")).json() == []
    assert accept(newbie, invitation).json() == ["This invitation has already been accepted."]


def test_inviting_again_resends_the_same_invitation(admin, org):
    roles = reverse("organization-roles", kwargs={"organization_id": org.id})
    admin.post(roles, {"email": "kim@example.com", "role": "hackathon_manager"}, format="json")
    admin.post(roles, {"email": "KIM@example.com", "role": "hackathon_manager"}, format="json")
    invitation = Invitation.objects.get()
    assert invitation.sent_count == 2
    assert mail.outbox[-1].subject == "Alice invited you to be a hackathon manager at JKUAT"
    assert str(invitation) == "kim@example.com: be a hackathon manager at JKUAT (Waiting for an answer)"


def test_inviters_resend_and_withdraw_and_the_invitee_declines(admin, bob, org):
    roles = reverse("organization-roles", kwargs={"organization_id": org.id})
    sent = admin.post(roles, {"email": "bob@example.com", "role": "event_organiser"}, format="json").json()
    manage = reverse("sent-invitation", kwargs={"pk": sent["id"]})

    assert bob.post(manage).status_code == 403
    assert admin.post(manage).json()["sent_count"] == 2
    assert len(mail.outbox) == 2
    invitation = Invitation.objects.get()
    assert bob.post(reverse("invitation-decline", kwargs={"token": invitation.token})).json()["status"] == "declined"
    assert admin.post(manage).json() == ["Only invitations still waiting for an answer can be sent again."]

    again = admin.post(roles, {"email": "bob@example.com", "role": "event_organiser"}, format="json").json()
    assert admin.delete(reverse("sent-invitation", kwargs={"pk": again["id"]})).status_code == 204
    withdrawn = Invitation.objects.get(pk=again["id"])
    assert accept(bob, withdrawn).json() == ["This invitation was withdrawn."]
    assert accept(bob, invitation).json() == ["This invitation was declined."]
    assert not RoleAssignment.objects.exists()


def test_team_leaders_manage_their_own_invitations(bob, carol, org):
    hackathon = make_hackathon(org, max_team_size=3)
    team = make_team(hackathon, bob, carol)
    invitation = baker.make(
        Invitation, kind=Kind.TEAM, email="new@example.com", team=team, hackathon=hackathon, invited_by=bob.profile,
    )
    manage = reverse("sent-invitation", kwargs={"pk": invitation.id})
    assert carol.delete(manage).status_code == 403
    assert bob.delete(manage).status_code == 204


def test_accepting_still_checks_the_rules(org, judy, bob, carol, dan):
    hackathon = make_hackathon(org, max_team_size=1)
    team = make_team(hackathon, carol)
    baker.make(Participant, hackathon=hackathon, profile=bob.profile)
    judging = baker.make(Invitation, kind=Kind.JUDGE, email="bob@example.com", hackathon=hackathon)
    joining = baker.make(Invitation, kind=Kind.TEAM, email="dan@example.com", team=team, hackathon=hackathon)

    assert accept(bob, judging).json() == ["You take part in this hackathon, so you cannot judge it."]
    assert accept(dan, joining).json() == ["This team is full."]
    # A refusal leaves the invitation open, so it can be accepted once things change.
    assert Invitation.objects.filter(status=Invitation.Status.PENDING).count() == 2
    TeamMember.objects.filter(team=team).delete()
    assert accept(dan, joining).status_code == 200
    assert team.members.get().profile == dan.profile


@pytest.mark.parametrize(
    ("kind", "summary"),
    [
        (Kind.JUDGE, "judge Build for Health"),
        (Kind.TEAM, "join Byte Me at Build for Health"),
    ],
)
def test_invitations_say_what_they_are_for(org, bob, anonymous, kind, summary):
    hackathon = make_hackathon(org)
    team = make_team(hackathon, bob)
    invitation = baker.make(Invitation, kind=kind, email="x@example.com", hackathon=hackathon, team=team, invited_by=None)
    page = anonymous.get(reverse("invitation", kwargs={"token": invitation.token})).json()
    assert (page["summary"], page["invited_by"]) == (summary, "Someone")
    services.send(invitation)
    assert mail.outbox[-1].subject == f"Someone invited you to {summary}"


def test_judges_and_team_members_are_not_invited_twice(admin, bob, judy, org):
    hackathon = make_hackathon(org)
    team = make_team(hackathon, bob)
    baker.make(Judge, hackathon=hackathon, profile=judy.profile)
    with pytest.raises(ValidationError, match="They judge this hackathon."):
        services.invite(Kind.PARTICIPANT, "judy@example.com", admin.profile, hackathon=hackathon)
    with pytest.raises(ValidationError, match="They judge this hackathon."):
        services.invite(Kind.TEAM, "judy@example.com", bob.profile, team=team, hackathon=hackathon)
    with pytest.raises(ValidationError, match="already in a team"):
        services.invite(Kind.TEAM, "bob@example.com", bob.profile, team=team, hackathon=hackathon)


def test_hackathon_managers_withdraw_judge_and_participant_invitations(admin, bob, org):
    invitation = baker.make(Invitation, kind=Kind.JUDGE, email="j@example.com", hackathon=make_hackathon(org))
    manage = reverse("sent-invitation", kwargs={"pk": invitation.id})
    assert bob.delete(manage).status_code == 403
    assert admin.delete(manage).status_code == 204
