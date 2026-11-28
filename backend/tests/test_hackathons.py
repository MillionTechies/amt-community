from datetime import timedelta

import pytest
from django.core import mail
from django.urls import reverse
from django.utils import timezone
from model_bakery import baker

from apps.accounts.models import RoleAssignment
from apps.hackathons.models import (
    Announcement,
    Challenge,
    Criterion,
    Evaluation,
    Hackathon,
    Judge,
    Participant,
    Score,
    Submission,
    Team,
    TeamMember,
)
from apps.hackathons.scoring import leaderboard
from apps.invitations.models import Invitation
from tests.conftest import in_days, sign_in

Status = Hackathon.Status


def make_hackathon(org, **fields):
    now = timezone.now()
    defaults = {
        "title": "Build for Health",
        "status": Status.PUBLISHED,
        "starts_at": now + timedelta(days=10),
        "ends_at": now + timedelta(days=12),
        "registration_deadline": now + timedelta(days=9),
        "submission_deadline": now + timedelta(days=12),
        "min_team_size": 1,
        "max_team_size": 2,
    }
    return baker.make(Hackathon, organization=org, **{**defaults, **fields})


def make_team(hackathon, leader, *members, name="Byte Me"):
    Participant.objects.bulk_create(
        [Participant(hackathon=hackathon, profile=person.profile) for person in (leader, *members)]
    )
    team = baker.make(Team, hackathon=hackathon, name=name)
    baker.make(TeamMember, team=team, hackathon=hackathon, profile=leader.profile, is_leader=True)
    TeamMember.objects.bulk_create(
        [TeamMember(team=team, hackathon=hackathon, profile=member.profile) for member in members]
    )
    return team


def url(name, hackathon, **kwargs):
    return reverse(name, kwargs={"slug": hackathon.slug, **kwargs})


def child_url(name, hackathon, **kwargs):
    return reverse(name, kwargs={"hackathon_slug": hackathon.slug, **kwargs})


def hackathon_data(org, **overrides):
    return {
        "organization_id": org.id,
        "title": "Build for Health",
        "starts_at": in_days(10),
        "ends_at": in_days(12),
        "registration_deadline": in_days(9),
        "submission_deadline": in_days(12),
        "min_team_size": 1,
        "max_team_size": 2,
        **overrides,
    }


def submission_data(**overrides):
    return {
        "title": "ClinicQueue",
        "description": "Shorter queues at clinics.",
        "repository_url": "https://github.com/example/clinicqueue",
        **overrides,
    }


@pytest.fixture
def hackathon(org):
    return make_hackathon(org)


@pytest.fixture
def dan():
    return sign_in("dan")


@pytest.fixture
def judy():
    return sign_in("judy")


@pytest.fixture
def rival(other_org):
    return sign_in("rita", admin_of=[other_org])


def test_an_organisations_managers_create_its_hackathons(admin, bob, org, other_org):
    create = reverse("hackathon-list")
    assert bob.post(create, hackathon_data(org), format="json").status_code == 403
    assert admin.post(create, hackathon_data(other_org), format="json").status_code == 403

    baker.make(RoleAssignment, profile=bob.profile, organization=org, role=RoleAssignment.Role.HACKATHON_MANAGER)
    created = bob.post(
        create,
        hackathon_data(
            org,
            description="<p>Build</p><script>x()</script>",
            prizes=[{"title": " Winner ", "value": "KES 60,000"}, {"title": "", "value": ""}],
        ),
        format="json",
    )
    assert created.status_code == 201
    body = created.json()
    assert body["description"] == "<p>Build</p>"
    assert body["prizes"] == [{"title": "Winner", "value": "KES 60,000"}]
    assert (body["status"], body["can_manage"], body["participant_preview"]) == ("draft", True, [])


@pytest.mark.parametrize(
    ("overrides", "errors"),
    [
        ({"organization_id": "org-missing"}, {"organization_id": ["Unknown organisation."]}),
        ({"ends_at": in_days(9)}, {"ends_at": ["The hackathon must end after it starts."]}),
        (
            {"registration_deadline": in_days(13)},
            {"registration_deadline": ["Registration must close before submissions do."]},
        ),
        (
            {"submission_deadline": in_days(9.5), "registration_deadline": in_days(9)},
            {"submission_deadline": ["Submissions cannot close before the hackathon starts."]},
        ),
        (
            {"min_team_size": 3, "max_team_size": 2},
            {"max_team_size": ["The largest team must be at least as big as the smallest."]},
        ),
        ({"prizes": "KES 10,000"}, {"prizes": ["Send prizes as a list."]}),
        ({"prizes": ["Winner"]}, {"prizes": ["Each prize needs a title and a value."]}),
        (
            {"prizes": [{"title": "", "value": "KES 10,000"}]},
            {"prizes": ["Give every prize a title, such as Winner."]},
        ),
        (
            {"prizes": [{"title": "W" * 101, "value": "1"}]},
            {"prizes": ["Keep prize titles and values under 100 characters."]},
        ),
        (
            {"prizes": [{"title": "Prize", "value": "1"}] * 21},
            {"prizes": ["A hackathon can list at most 20 prizes."]},
        ),
    ],
)
def test_hackathon_details_must_make_sense(admin, org, overrides, errors):
    response = admin.post(reverse("hackathon-list"), hackathon_data(org, **overrides), format="json")
    assert response.status_code == 400
    assert response.json() == errors
    assert not Hackathon.objects.exists()


def test_only_its_organisations_managers_run_a_hackathon(admin, bob, rival, other_org, hackathon):
    detail = url("hackathon-detail", hackathon)
    prizes = {"prizes": [{"title": "Best design", "value": "Laptop"}]}
    assert rival.patch(detail, prizes, format="json").status_code == 403
    assert rival.get(url("hackathon-judges", hackathon)).status_code == 403
    assert rival.post(child_url("hackathon-criteria", hackathon), {"name": "X"}, format="json").status_code == 403
    assert bob.post(url("hackathon-transition", hackathon), {"status": "cancelled"}, format="json").status_code == 403
    assert bob.post(child_url("hackathon-challenges", hackathon), {"title": "X"}, format="json").status_code == 403

    assert admin.patch(detail, prizes, format="json").json()["prizes"] == prizes["prizes"]
    moved = admin.patch(detail, {"organization_id": other_org.id}, format="json")
    assert moved.json() == {"organization_id": ["A hackathon cannot move to another organisation."]}


def test_hackathon_lists_show_what_each_person_may_see(admin, bob, judy, rival, anonymous, org, other_org):
    draft = make_hackathon(org, status=Status.DRAFT)
    theirs = make_hackathon(other_org, title="Theirs")
    team = make_team(theirs, bob)
    baker.make(Judge, hackathon=theirs, profile=judy.profile)
    root = sign_in("root", platform_admin=True)

    def slugs(client, **params):
        return [h["slug"] for h in client.get(reverse("hackathon-list"), params).json()["results"]]

    assert slugs(anonymous) == [theirs.slug]
    assert slugs(anonymous, scope="mine") == []
    assert slugs(bob, scope="mine") == slugs(judy, scope="mine") == [theirs.slug]
    assert slugs(admin, scope="managed") == [draft.slug]
    assert slugs(rival, scope="managed") == [theirs.slug]
    assert slugs(root, scope="managed") == []

    assert anonymous.get(url("hackathon-detail", draft)).status_code == 404
    assert root.get(url("hackathon-detail", draft)).status_code == 404
    assert bob.post(url("hackathon-teams", draft), {"name": "Solo"}, format="json").status_code == 404
    seen_by_bob = bob.get(url("hackathon-detail", theirs)).json()
    assert (seen_by_bob["my_team_id"], seen_by_bob["is_judge"], seen_by_bob["can_manage"]) == (team.id, False, False)
    assert seen_by_bob["participant_preview"] == ["B"]
    assert judy.get(url("hackathon-detail", theirs)).json()["is_judge"] is True


def test_only_drafts_can_be_deleted(admin, bob, org):
    draft = make_hackathon(org, status=Status.DRAFT)
    live = make_hackathon(org, title="Live")
    assert bob.delete(url("hackathon-detail", draft)).status_code == 404
    refused = admin.delete(url("hackathon-detail", live))
    assert refused.json() == ["Only drafts can be deleted. Cancel a published hackathon instead."]
    assert admin.delete(url("hackathon-detail", draft)).status_code == 204
    assert list(Hackathon.objects.all()) == [live]


@pytest.mark.parametrize(
    ("status", "cancelled_from", "criteria", "target", "code", "error", "ends_as"),
    [
        ("draft", "", 1, "published", 200, "", ("published", "")),
        ("draft", "", 1, "completed", 400, "A hackathon that is draft cannot become completed.", ("draft", "")),
        ("published", "", 1, "judging", 200, "", ("judging", "")),
        ("published", "", 0, "judging", 400, "Add at least one judging criterion", ("published", "")),
        ("judging", "", 1, "cancelled", 200, "", ("cancelled", "judging")),
        ("cancelled", "published", 1, "published", 200, "", ("published", "")),
        ("cancelled", "judging", 1, "judging", 200, "", ("judging", "")),
        ("cancelled", "judging", 1, "published", 400, "can only be restored to that", ("cancelled", "judging")),
    ],
)
def test_a_hackathon_moves_through_its_statuses(admin, org, status, cancelled_from, criteria, target, code, error, ends_as):
    hackathon = make_hackathon(org, status=status, cancelled_from=cancelled_from)
    Criterion.objects.bulk_create(baker.prepare(Criterion, hackathon=hackathon, _quantity=2)[:criteria])
    response = admin.post(url("hackathon-transition", hackathon), {"status": target}, format="json")
    assert response.status_code == code
    assert error in response.content.decode()
    hackathon.refresh_from_db()
    assert (hackathon.status, hackathon.cancelled_from) == ends_as


def test_members_form_teams_with_invite_codes(admin, bob, carol, dan, hackathon):
    teams = url("hackathon-teams", hackathon)
    join = url("hackathon-join-team", hackathon)
    created = bob.post(teams, {"name": "Byte Me"}, format="json")
    assert created.status_code == 201
    assert created.json()["members"][0]["is_leader"] is True
    code = created.json()["invite_code"]
    assert bob.post(teams, {"name": "Second"}, format="json").json() == ["You are already in a team for this hackathon."]
    assert carol.post(teams, {"name": "Byte Me"}, format="json").json() == {"name": "A team with this name already exists."}

    assert carol.post(join, {"invite_code": "wrong"}, format="json").json() == {"invite_code": "No team has this invite code."}
    assert carol.post(join, {"invite_code": code}, format="json").status_code == 201
    assert dan.post(join, {"invite_code": code}, format="json").json() == ["This team is full."]

    detail = bob.get(url("hackathon-detail", hackathon)).json()
    assert (detail["team_count"], detail["participant_count"], detail["my_team_id"]) == (1, 2, created.json()["id"])
    # Managers and registered participants list the teams; nobody sees their codes.
    assert dan.get(teams).status_code == 403
    listed = admin.get(teams).json()
    assert listed[0]["name"] == "Byte Me" and "invite_code" not in listed[0]
    assert listed[0]["spots_left"] == 0
    assert dan.get(url("hackathon-my-team", hackathon)).status_code == 404
    baker.make(Participant, hackathon=hackathon, profile=dan.profile)
    assert [t["name"] for t in dan.get(teams).json()] == ["Byte Me"]


def test_members_register_before_they_find_a_team(admin, bob, carol, anonymous, hackathon):
    registration = url("hackathon-registration", hackathon)
    participants = url("hackathon-participants", hackathon)
    assert bob.patch(registration, {"looking_for_team": True}, format="json").status_code == 404
    assert bob.post(registration).status_code == 201
    assert bob.post(registration).json() == ["You are already registered for this hackathon."]
    detail = bob.get(url("hackathon-detail", hackathon)).json()
    assert (detail["is_registered"], detail["my_team_id"], detail["participant_count"]) == (True, None, 1)
    assert bob.patch(registration, {"looking_for_team": True}, format="json").json()["looking_for_team"] is True

    assert carol.get(participants).status_code == 403
    assert anonymous.get(participants).status_code == 401
    looking = admin.get(participants).json()
    assert [(p["person"]["name"], p["looking_for_team"], p["team_name"]) for p in looking] == [("Bob", True, None)]
    assert "skills" in looking[0]["person"]

    team = make_team(hackathon, carol)
    baker.make(TeamMember, team=team, hackathon=hackathon, profile=bob.profile)
    assert bob.get(participants).json()[0]["team_name"] == "Byte Me"
    assert bob.delete(registration).json() == ["Leave your team before you withdraw."]
    TeamMember.objects.filter(profile=bob.profile).delete()
    Hackathon.objects.filter(pk=hackathon.pk).update(status=Status.JUDGING)
    assert bob.delete(registration).json() == ["You can only withdraw while the hackathon is open."]
    Hackathon.objects.filter(pk=hackathon.pk).update(status=Status.PUBLISHED)
    assert bob.delete(registration).status_code == 204
    assert not Participant.objects.filter(profile=bob.profile).exists()


def test_six_digit_codes_register_for_a_hackathon_or_join_a_team(bob, carol, dan, hackathon):
    join = reverse("join")
    spaced = f"{hackathon.join_code[:3]} {hackathon.join_code[3:]}"
    assert bob.post(join, {"code": spaced}, format="json").json() == {"hackathon": hackathon.slug, "team_id": None}
    assert Participant.objects.filter(hackathon=hackathon, profile=bob.profile).exists()

    team = make_team(hackathon, carol)
    joined = dan.post(join, {"code": team.invite_code}, format="json").json()
    assert joined == {"hackathon": hackathon.slug, "team_id": team.id}
    assert team.members.count() == 2

    assert bob.post(join, {"code": "12"}, format="json").json() == {"code": ["Enter the 6-digit code."]}
    taken = {hackathon.join_code, team.invite_code}
    unused = next(c for c in ("000000", "000001", "000002") if c not in taken)
    assert bob.post(join, {"code": unused}, format="json").json() == {"code": "No hackathon or team has this code."}


def test_codes_never_repeat(monkeypatch, hackathon):
    from apps.hackathons import models

    picks = iter([hackathon.join_code, "000123"])
    monkeypatch.setattr(models, "_six_digits", lambda: next(picks))
    assert models.new_code() == "000123"
    # Teams made before 6-digit codes keep their old ones, which still work.
    assert len(models.new_invite_code()) == 12


def test_hackathons_from_before_join_codes_get_one_when_next_saved(admin, org):
    hackathon = make_hackathon(org)
    baker.make(Criterion, hackathon=hackathon)
    Hackathon.objects.filter(pk=hackathon.pk).update(join_code=None)
    admin.post(url("hackathon-transition", hackathon), {"status": "judging"}, format="json")
    assert len(Hackathon.objects.get(pk=hackathon.pk).join_code) == 6


def test_leaders_open_their_team_to_anyone(bob, carol, dan, hackathon):
    team = make_team(hackathon, bob)
    make_team(hackathon, dan, name="Taken")
    my_team = url("hackathon-my-team", hackathon)
    join_open = url("hackathon-join-open-team", hackathon, team_id=team.id)

    assert carol.post(join_open).json() == {"detail": "This team is invite only. Ask its leader for the code."}
    assert bob.patch(my_team, {"name": "Taken"}, format="json").json() == {"name": "A team with this name already exists."}
    opened = bob.patch(my_team, {"is_open": True, "name": "Open Door"}, format="json").json()
    assert (opened["is_open"], opened["name"], opened["spots_left"]) == (True, "Open Door", 1)
    assert carol.post(join_open).status_code == 201
    assert carol.patch(my_team, {"is_open": False}, format="json").status_code == 403
    assert dan.post(join_open).json() == ["You are already in a team for this hackathon."]

    Hackathon.objects.filter(pk=hackathon.pk).update(status=Status.JUDGING)
    assert bob.patch(my_team, {"is_open": False}, format="json").json() == ["Teams are fixed once judging starts."]


def test_unlisted_hackathons_stay_off_the_public_list(admin, bob, anonymous, org):
    hidden = make_hackathon(org, listed=False)
    make_team(hidden, bob)

    def slugs(client, **params):
        return [h["slug"] for h in client.get(reverse("hackathon-list"), params).json()["results"]]

    assert slugs(anonymous) == slugs(bob) == []
    assert slugs(bob, scope="mine") == slugs(admin) == [hidden.slug]
    assert anonymous.get(url("hackathon-detail", hidden)).json()["join_code"] is None
    assert admin.get(url("hackathon-detail", hidden)).json()["join_code"] == hidden.join_code


def test_judges_see_the_hackathons_they_judge_and_their_progress(judy, bob, hackathon, entries):
    _, submissions, judge = entries
    baker.make(Evaluation, judge=judge, submission=submissions[0])
    judging = judy.get(reverse("hackathon-list"), {"scope": "judging"}).json()["results"]
    assert [(h["slug"], h["my_scores"]) for h in judging] == [(hackathon.slug, 1)]
    assert bob.get(url("hackathon-detail", hackathon)).json()["my_scores"] is None


@pytest.mark.parametrize(
    ("registration_closes_in", "person", "error"),
    [
        (-1, "bob", "Registration for this hackathon is closed."),
        (1, "judy", "Judges cannot take part in the hackathon they judge."),
    ],
)
def test_judges_and_late_comers_cannot_take_part(request, judy, org, registration_closes_in, person, error):
    hackathon = make_hackathon(org, registration_deadline=timezone.now() + timedelta(days=registration_closes_in))
    baker.make(Judge, hackathon=hackathon, profile=judy.profile)
    response = request.getfixturevalue(person).post(url("hackathon-teams", hackathon), {"name": "Late"}, format="json")
    assert response.json() == [error]


def test_leadership_passes_on_and_an_empty_team_goes(admin, bob, carol, dan, org):
    hackathon = make_hackathon(org, max_team_size=3)
    make_team(hackathon, bob, carol, dan)
    leave = url("hackathon-leave-team", hackathon)
    my_team = url("hackathon-my-team", hackathon)

    assert carol.post(leave).status_code == 204
    assert [(m["person"]["name"], m["is_leader"]) for m in bob.get(my_team).json()["members"]] == [
        ("Bob", True), ("Dan", False),
    ]
    assert bob.post(leave).status_code == 204
    assert dan.get(my_team).json()["members"][0]["is_leader"] is True
    assert dan.post(leave).status_code == 204
    assert not Team.objects.exists()


def test_leaders_remove_members_until_judging_starts(bob, carol, hackathon):
    team = make_team(hackathon, bob, carol)
    bob_id, carol_id = team.members.values_list("id", flat=True)
    remove_bob = url("hackathon-remove-member", hackathon, member_id=bob_id)
    remove_carol = url("hackathon-remove-member", hackathon, member_id=carol_id)

    assert carol.delete(remove_bob).status_code == 403
    assert bob.delete(remove_bob).json() == ["To go yourself, leave the team."]
    Hackathon.objects.filter(pk=hackathon.pk).update(status=Status.JUDGING)
    assert bob.delete(remove_carol).json() == ["Teams are fixed once judging starts."]
    assert carol.post(url("hackathon-leave-team", hackathon)).json() == ["Teams are fixed once judging starts."]
    Hackathon.objects.filter(pk=hackathon.pk).update(status=Status.PUBLISHED)
    assert [m["person"]["name"] for m in bob.delete(remove_carol).json()["members"]] == ["Bob"]


def test_teams_submit_their_project_before_the_deadline(bob, carol, org):
    hackathon = make_hackathon(org, min_team_size=2)
    challenge = baker.make(Challenge, hackathon=hackathon, title="Telemedicine")
    elsewhere = baker.make(Challenge, hackathon=make_hackathon(org, title="Other"))
    submit = url("hackathon-submit", hackathon)

    assert carol.put(submit, submission_data(), format="json").status_code == 404
    team = make_team(hackathon, bob)
    assert bob.put(submit, submission_data(), format="json").json() == ["Teams need at least 2 members to submit."]
    baker.make(TeamMember, team=team, hackathon=hackathon, profile=carol.profile)
    assert "repository_url" in bob.put(submit, submission_data(repository_url=""), format="json").json()
    wrong = bob.put(submit, submission_data(challenge_id=elsewhere.id), format="json")
    assert wrong.json() == {"challenge_id": ["This challenge belongs to another hackathon."]}

    assert bob.get(url("hackathon-my-team", hackathon)).json()["submission"] is None
    submitted = bob.put(submit, submission_data(challenge_id=challenge.id), format="json").json()
    assert submitted["submission"]["challenge"]["title"] == "Telemedicine"
    # Any member can revise it.
    revised = carol.put(submit, submission_data(title="ClinicQueue 2"), format="json").json()
    assert revised["submission"]["title"] == "ClinicQueue 2"
    assert bob.get(url("hackathon-detail", hackathon)).json()["submission_count"] == 1

    Hackathon.objects.filter(pk=hackathon.pk).update(submission_deadline=timezone.now() - timedelta(minutes=1))
    assert bob.put(submit, submission_data(), format="json").json() == ["Submissions for this hackathon are closed."]


def test_managers_invite_judges_and_participants_by_email(admin, bob, judy, hackathon):
    invite = url("hackathon-invitations", hackathon)
    judges = url("hackathon-judges", hackathon)
    make_team(hackathon, bob)
    body = {"kind": "judge", "emails": ["judy@example.com", "bob@example.com", "new@example.com", "JUDY@example.com"]}
    assert bob.post(invite, body, format="json").status_code == 403
    sent = admin.post(invite, body, format="json")
    assert sent.json() == {"refused": {"bob@example.com": "They take part in this hackathon."}}
    participants = admin.post(invite, {"kind": "participant", "emails": ["guest@example.com"]}, format="json")
    assert participants.json() == {"refused": {}}
    pending = admin.get(invite).json()
    assert sorted((i["kind"], i["email"]) for i in pending) == [
        ("judge", "judy@example.com"), ("judge", "new@example.com"), ("participant", "guest@example.com"),
    ]

    token = Invitation.objects.get(email="judy@example.com").token
    judy.post(reverse("invitation-accept", kwargs={"token": token}))
    added = admin.get(judges).json()
    assert [(j["email"], j["evaluations"]) for j in added] == [("judy@example.com", 0)]
    assert judy.get(reverse("me")).json()["judges_anything"] is True

    remove = url("hackathon-remove-judge", hackathon, judge_id=added[0]["id"])
    assert bob.delete(remove).status_code == 403
    assert admin.delete(remove).status_code == 204
    assert admin.get(judges).json() == []
    assert admin.delete(remove).status_code == 404


def test_leaders_invite_teammates_by_email_or_from_the_looking_list(bob, carol, dan, org):
    hackathon = make_hackathon(org, max_team_size=3)
    make_team(hackathon, bob)
    invite = url("hackathon-invite-teammate", hackathon)
    baker.make(Participant, hackathon=hackathon, profile=carol.profile, looking_for_team=True)

    assert bob.post(invite, {}, format="json").json() == {"email": ["Give an email address."]}
    assert bob.post(invite, {"sub": dan.profile.sub}, format="json").json() == {
        "sub": ["This person is not registered for the hackathon."]
    }
    by_sub = bob.post(invite, {"sub": carol.profile.sub}, format="json").json()
    assert [i["name"] for i in by_sub["pending_invitations"]] == ["Carol"]
    assert bob.post(invite, {"email": "friend@example.com"}, format="json").status_code == 201
    # Two members' worth of invitations fill a team of three.
    assert bob.post(invite, {"email": "third@example.com"}, format="json").json() == {
        "email": "Your team is full, counting the invitations already sent."
    }
    assert carol.post(invite, {"email": "x@example.com"}, format="json").status_code == 404

    token = Invitation.objects.get(email="carol@example.com").token
    carol.post(reverse("invitation-accept", kwargs={"token": token}))
    team = bob.get(url("hackathon-my-team", hackathon)).json()
    assert [m["person"]["name"] for m in team["members"]] == ["Bob", "Carol"]
    assert [i["name"] for i in team["pending_invitations"]] == ["friend@example.com"]
    assert carol.post(invite, {"email": "y@example.com"}, format="json").json() == {
        "detail": "Only the team leader invites people."
    }
    Hackathon.objects.filter(pk=hackathon.pk).update(registration_deadline=timezone.now())
    assert bob.post(invite, {"email": "late@example.com"}, format="json").json() == [
        "Registration has closed, so teams can no longer grow."
    ]


@pytest.fixture
def entries(hackathon, bob, carol, judy):
    """Two submissions, two criteria (Innovation counts double) and a judge."""
    criteria = (
        baker.make(Criterion, hackathon=hackathon, name="Innovation", max_score=10, weight=2),
        baker.make(Criterion, hackathon=hackathon, name="Execution", max_score=10, weight=1),
    )
    submissions = (
        baker.make(Submission, team=make_team(hackathon, bob), title="ClinicQueue"),
        baker.make(Submission, team=make_team(hackathon, carol, name="Null Pointers"), title="MedTrack"),
    )
    judge = baker.make(Judge, hackathon=hackathon, profile=judy.profile)
    return criteria, submissions, judge


def scores(criteria, *values, comment="Solid work."):
    return {
        "scores": [{"criterion": c.id, "value": v} for c, v in zip(criteria, values, strict=False)],
        "comment": comment,
    }


def test_judges_score_submissions_while_judging(admin, bob, judy, dan, hackathon, entries):
    criteria, (clinic_queue, _), _ = entries
    evaluate = url("hackathon-evaluate", hackathon, submission_id=clinic_queue.id)
    submissions = url("hackathon-submissions", hackathon)

    assert judy.put(evaluate, scores(criteria, 9, 6), format="json").json() == [
        "Scoring is open only while the hackathon is being judged."
    ]
    Hackathon.objects.filter(pk=hackathon.pk).update(status=Status.JUDGING)
    assert bob.put(evaluate, scores(criteria, 10, 10), format="json").status_code == 403
    assert judy.put(evaluate, scores(criteria, 11, 6), format="json").json() == {"scores": "Innovation is out of 10."}
    assert judy.put(evaluate, scores(criteria, 9), format="json").json() == {"scores": "Give one score for every criterion."}
    assert judy.put(evaluate, scores(criteria, 1, 1), format="json").status_code == 200
    revised = judy.put(evaluate, scores(criteria, 9, 6), format="json").json()
    assert revised["scores"] == [{"criterion": criteria[0].id, "value": 9}, {"criterion": criteria[1].id, "value": 6}]
    assert Score.objects.count() == 2
    # Criteria are fixed once judging starts.
    assert admin.post(child_url("hackathon-criteria", hackathon), {"name": "Late"}, format="json").json() == [
        "Criteria are fixed once judging starts."
    ]

    assert dan.get(submissions).status_code == 403
    assert [s["my_evaluation"] for s in admin.get(submissions).json()] == [None, None]
    seen_by_judge = judy.get(submissions).json()
    assert [(s["title"], s["members"]) for s in seen_by_judge] == [("ClinicQueue", ["Bob"]), ("MedTrack", ["Carol"])]
    assert seen_by_judge[0]["my_evaluation"]["comment"] == "Solid work."

    Hackathon.objects.filter(pk=hackathon.pk).update(status=Status.COMPLETED)
    assert judy.put(evaluate, scores(criteria, 1, 1), format="json").status_code == 400  # results are final


def test_the_leaderboard_is_public_once_results_are_published(admin, dan, anonymous, hackathon, entries):
    criteria, (clinic_queue, med_track), judge = entries
    evaluation = baker.make(Evaluation, submission=clinic_queue, judge=judge)
    baker.make(Score, evaluation=evaluation, criterion=iter(criteria), value=iter([9, 6]), _quantity=2)
    board = url("hackathon-leaderboard", hackathon)

    assert dan.get(board).status_code == 403
    assert anonymous.get(board).status_code == 403
    assert [(r["rank"], r["submission"]["title"], r["score"], r["judges"]) for r in admin.get(board).json()] == [
        (1, "ClinicQueue", 80.0, 1), (None, "MedTrack", None, 1),
    ]
    Hackathon.objects.filter(pk=hackathon.pk).update(status=Status.COMPLETED)
    assert anonymous.get(board).json()[0]["submission"]["title"] == "ClinicQueue"
    assert len(anonymous.get(url("hackathon-submissions", hackathon)).json()) == 2


@pytest.mark.parametrize(
    ("weights", "marks", "ranks"),
    [
        # Innovation counts double: (9/10*2 + 6/10*1) / 3 = 80%, against 70%.
        ((2, 1), ((9, 6), (6, 9)), [(1, 80.0, 1), (2, 70.0, 1)]),
        ((2, 1), ((7, 7), (7, 7)), [(1, 70.0, 1), (1, 70.0, 1)]),
        ((0, 0), ((7, 7), (7, 7)), [(None, None, 0), (None, None, 0)]),
    ],
)
def test_leaderboard_ranks_by_weighted_score(hackathon, entries, weights, marks, ranks):
    criteria, submissions, judge = entries
    Criterion.objects.filter(pk=criteria[0].pk).update(weight=weights[0])
    Criterion.objects.filter(pk=criteria[1].pk).update(weight=weights[1])
    evaluations = baker.make(Evaluation, submission=iter(submissions), judge=judge, _quantity=2)
    baker.make(
        Score,
        evaluation=iter([evaluations[0], evaluations[0], evaluations[1], evaluations[1]]),
        criterion=iter(criteria * 2),
        value=iter(marks[0] + marks[1]),
        _quantity=4,
    )
    assert [(row["rank"], row["score"], row["evaluations"]) for row in leaderboard(hackathon)] == ranks


def test_managers_edit_and_remove_challenges_and_criteria(admin, bob, hackathon):
    created = admin.post(child_url("hackathon-challenges", hackathon), {"title": "Telemedicine"}, format="json").json()
    challenge = child_url("hackathon-challenge", hackathon, pk=created["id"])
    assert admin.patch(challenge, {"title": "Remote care"}, format="json").json()["title"] == "Remote care"
    assert bob.patch(challenge, {"title": "Mine"}, format="json").status_code == 403
    assert admin.delete(challenge).status_code == 204
    assert not Challenge.objects.exists()

    criterion = admin.post(child_url("hackathon-criteria", hackathon), {"name": "Innovation"}, format="json").json()
    assert (criterion["max_score"], criterion["weight"]) == (10, 1)
    assert admin.delete(child_url("hackathon-criterion", hackathon, pk=criterion["id"])).status_code == 204
    assert admin.get(url("hackathon-detail", hackathon)).json()["criteria"] == []


def test_managers_post_announcements_and_may_email_them(admin, bob, carol, anonymous, hackathon):
    make_team(hackathon, bob)
    baker.make(Judge, hackathon=hackathon, profile=carol.profile)
    announcements = child_url("hackathon-announcements", hackathon)
    note = {"title": "Kick-off moved", "body": "<p>Now at <b>10:00</b></p><script>x()</script>"}

    assert bob.post(announcements, note, format="json").status_code == 403
    quiet = admin.post(announcements, note, format="json").json()
    assert quiet["body"] == "<p>Now at <b>10:00</b></p>" and mail.outbox == []
    loud = admin.post(announcements, {**note, "notify": True}, format="json")
    assert loud.json()["emailed_to"] == 2
    assert sorted(m.to[0] for m in mail.outbox) == ["bob@example.com", "carol@example.com"]

    assert [a["title"] for a in anonymous.get(announcements).json()] == ["Kick-off moved", "Kick-off moved"]
    remove = child_url("hackathon-announcement", hackathon, pk=quiet["id"])
    assert bob.delete(remove).status_code == 403
    assert admin.delete(remove).status_code == 204
    assert Announcement.objects.count() == 1


def test_records_read_as_their_names(hackathon, bob):
    team = make_team(hackathon, bob)
    assert [
        str(hackathon),
        str(baker.make(Challenge, title="Telemedicine")),
        str(baker.make(Criterion, name="Innovation")),
        str(team),
        str(baker.make(Submission, team=team, title="ClinicQueue")),
        str(baker.make(Announcement, title="Kick-off moved")),
    ] == ["Build for Health", "Telemedicine", "Innovation", "Byte Me", "ClinicQueue", "Kick-off moved"]
