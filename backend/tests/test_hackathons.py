from datetime import timedelta

import pytest
from django.utils import timezone

from apps.hackathons.models import Announcement, Challenge, Criterion, Hackathon, Submission, Team, TeamMember
from apps.hackathons.scoring import leaderboard
from tests.conftest import in_days, sign_in


def hackathon_data(org, **overrides):
    return {
        "organization_id": org.id,
        "title": "Build for Health",
        "theme": "Digital health",
        "starts_at": in_days(10),
        "ends_at": in_days(12),
        "registration_deadline": in_days(9),
        "submission_deadline": in_days(12),
        "min_team_size": 1,
        "max_team_size": 2,
        **overrides,
    }


def create_hackathon(client, org, publish=True, **overrides):
    response = client.post("/api/hackathons/", hackathon_data(org, **overrides), format="json")
    assert response.status_code == 201, response.content
    hackathon = response.json()
    url = f"/api/hackathons/{hackathon['slug']}/"
    for name, weight in (("Innovation", 2), ("Execution", 1)):
        created = client.post(
            f"{url}criteria/", {"name": name, "max_score": 10, "weight": weight}, format="json"
        )
        assert created.status_code == 201, created.content
    if publish:
        move(client, hackathon["slug"], "published")
    return client.get(url).json()


def move(client, hackathon_slug, status):
    response = client.post(
        f"/api/hackathons/{hackathon_slug}/transition/", {"status": status}, format="json"
    )
    assert response.status_code == 200, response.content
    return response.json()


def submission_data(**overrides):
    return {
        "title": "ClinicQueue",
        "description": "Shorter queues at clinics.",
        "repository_url": "https://github.com/example/clinicqueue",
        "demo_url": "https://clinicqueue.example.com",
        **overrides,
    }


def test_only_managers_create_hackathons(admin, bob, org, other_org):
    assert bob.post("/api/hackathons/", hackathon_data(org), format="json").status_code == 403
    assert admin.post("/api/hackathons/", hackathon_data(other_org), format="json").status_code == 403
    admin.post(
        f"/api/organizations/{org.id}/roles/",
        {"email": "bob@example.com", "role": "hackathon_manager"}, format="json",
    )
    assert bob.post("/api/hackathons/", hackathon_data(org), format="json").status_code == 201


def test_dates_and_team_sizes_must_make_sense(admin, org):
    late = admin.post(
        "/api/hackathons/", hackathon_data(org, registration_deadline=in_days(13)), format="json"
    )
    assert "registration_deadline" in late.json()
    sizes = admin.post(
        "/api/hackathons/", hackathon_data(org, min_team_size=3, max_team_size=2), format="json"
    )
    assert "max_team_size" in sizes.json()


def test_drafts_are_hidden(admin, bob, anonymous, org):
    hackathon = create_hackathon(admin, org, publish=False)
    url = f"/api/hackathons/{hackathon['slug']}/"
    assert anonymous.get(url).status_code == 404
    assert bob.post(f"{url}teams/", {"name": "Solo"}, format="json").status_code == 404
    move(admin, hackathon["slug"], "published")
    assert [c["name"] for c in anonymous.get(url).json()["criteria"]] == ["Innovation", "Execution"]


def test_team_formation(admin, bob, carol, org):
    hackathon = create_hackathon(admin, org)
    url = f"/api/hackathons/{hackathon['slug']}/"
    dan = sign_in("dan")

    team = bob.post(f"{url}teams/", {"name": "Byte Me"}, format="json")
    assert team.status_code == 201
    assert team.json()["members"][0]["is_leader"] is True
    code = team.json()["invite_code"]
    assert bob.post(f"{url}teams/", {"name": "Second"}, format="json").status_code == 400
    assert carol.post(f"{url}teams/", {"name": "Byte Me"}, format="json").status_code == 400

    assert carol.post(f"{url}teams/join/", {"invite_code": "wrong"}, format="json").status_code == 400
    assert carol.post(f"{url}teams/join/", {"invite_code": code}, format="json").status_code == 201
    full = dan.post(f"{url}teams/join/", {"invite_code": code}, format="json")  # max is 2
    assert full.status_code == 400

    detail = bob.get(url).json()
    assert (detail["team_count"], detail["participant_count"]) == (1, 2)
    assert detail["my_team_id"] == team.json()["id"]
    # Other people see the team, but never its invite code.
    listed = dan.get(f"{url}teams/").json()
    assert listed[0]["name"] == "Byte Me" and "invite_code" not in listed[0]
    assert dan.get(f"{url}my-team/").status_code == 404
    assert bob.get("/api/hackathons/?scope=mine").json()["count"] == 1


def test_leader_removes_members_and_leadership_passes_on(admin, bob, carol, org):
    hackathon = create_hackathon(admin, org)
    url = f"/api/hackathons/{hackathon['slug']}/"
    code = bob.post(f"{url}teams/", {"name": "Byte Me"}, format="json").json()["invite_code"]
    members = carol.post(f"{url}teams/join/", {"invite_code": code}, format="json").json()["members"]
    bob_id, carol_id = members[0]["id"], members[1]["id"]

    assert carol.delete(f"{url}my-team/members/{bob_id}/").status_code == 403
    assert bob.delete(f"{url}my-team/members/{carol_id}/").status_code == 200
    carol.post(f"{url}teams/join/", {"invite_code": code}, format="json")

    assert bob.post(f"{url}my-team/leave/").status_code == 204
    assert carol.get(f"{url}my-team/").json()["members"][0]["is_leader"] is True
    assert carol.post(f"{url}my-team/leave/").status_code == 204
    assert admin.get(f"{url}teams/").json() == []  # the empty team is gone


def test_registration_closes_at_the_deadline(admin, bob, org):
    hackathon = create_hackathon(admin, org)
    Hackathon.objects.filter(slug=hackathon["slug"]).update(
        registration_deadline=timezone.now() - timedelta(hours=1)
    )
    response = bob.post(f"/api/hackathons/{hackathon['slug']}/teams/", {"name": "Late"}, format="json")
    assert response.status_code == 400


def test_submission_rules(admin, bob, carol, org):
    hackathon = create_hackathon(admin, org, min_team_size=2)
    url = f"/api/hackathons/{hackathon['slug']}/"
    assert carol.put(f"{url}my-team/submission/", submission_data(), format="json").status_code == 404
    code = bob.post(f"{url}teams/", {"name": "Byte Me"}, format="json").json()["invite_code"]
    small = bob.put(f"{url}my-team/submission/", submission_data(), format="json")
    assert small.status_code == 400  # needs two members
    carol.post(f"{url}teams/join/", {"invite_code": code}, format="json")

    missing = bob.put(f"{url}my-team/submission/", submission_data(repository_url=""), format="json")
    assert "repository_url" in missing.json()
    assert bob.put(f"{url}my-team/submission/", submission_data(), format="json").status_code == 200
    # Any member can revise it before the deadline.
    revised = carol.put(
        f"{url}my-team/submission/", submission_data(title="ClinicQueue 2"), format="json"
    )
    assert revised.json()["submission"]["title"] == "ClinicQueue 2"
    assert bob.get(url).json()["submission_count"] == 1

    Hackathon.objects.filter(slug=hackathon["slug"]).update(
        submission_deadline=timezone.now() - timedelta(minutes=1)
    )
    assert bob.put(f"{url}my-team/submission/", submission_data(), format="json").status_code == 400


def test_judging_and_leaderboard(admin, bob, carol, anonymous, org):
    hackathon = create_hackathon(admin, org)
    url = f"/api/hackathons/{hackathon['slug']}/"
    judge = sign_in("judy")
    dan = sign_in("dan")
    innovation, execution = (c["id"] for c in hackathon["criteria"])

    for client, team, title in ((bob, "Byte Me", "ClinicQueue"), (carol, "Null Pointers", "MedTrack")):
        client.post(f"{url}teams/", {"name": team}, format="json")
        client.put(f"{url}my-team/submission/", submission_data(title=title), format="json")

    # Judges are added by email; participants cannot judge and judges cannot take part.
    assert bob.post(f"{url}judges/", {"email": "judy@example.com"}, format="json").status_code == 403
    assert admin.post(f"{url}judges/", {"email": "bob@example.com"}, format="json").status_code == 400
    assert admin.post(f"{url}judges/", {"email": "judy@example.com"}, format="json").status_code == 200
    assert judge.post(f"{url}teams/", {"name": "Sneaky"}, format="json").status_code == 400
    assert judge.get(url).json()["is_judge"] is True

    submissions = {s["title"]: s["id"] for s in judge.get(f"{url}submissions/").json()}
    assert set(submissions) == {"ClinicQueue", "MedTrack"}
    assert dan.get(f"{url}submissions/").status_code == 403
    assert dan.get(f"{url}leaderboard/").status_code == 403

    def scores(a, b):
        return {
            "scores": [{"criterion": innovation, "value": a}, {"criterion": execution, "value": b}],
            "comment": "Solid work.",
        }

    evaluate = f"{url}submissions/{submissions['ClinicQueue']}/evaluation/"
    assert judge.put(evaluate, scores(9, 6), format="json").status_code == 400  # not judging yet
    move(admin, hackathon["slug"], "judging")
    assert bob.put(evaluate, scores(10, 10), format="json").status_code == 403
    assert judge.put(evaluate, scores(11, 6), format="json").status_code == 400  # over the maximum
    partial = {"scores": [{"criterion": innovation, "value": 9}]}
    assert judge.put(evaluate, partial, format="json").status_code == 400
    assert judge.put(evaluate, scores(9, 6), format="json").status_code == 200
    judge.put(f"{url}submissions/{submissions['MedTrack']}/evaluation/", scores(6, 9), format="json")
    # Teams and criteria are fixed once judging starts.
    assert bob.post(f"{url}my-team/leave/").status_code == 400
    assert admin.post(f"{url}criteria/", {"name": "Late"}, format="json").status_code == 400

    board = admin.get(f"{url}leaderboard/").json()
    # Innovation counts double: (9/10*2 + 6/10*1) / 3 = 80%, against 70%.
    assert [(r["rank"], r["submission"]["title"], r["score"]) for r in board] == [
        (1, "ClinicQueue", 80.0), (2, "MedTrack", 70.0),
    ]
    assert judge.get(f"{url}submissions/").json()[0]["my_evaluation"]["comment"] == "Solid work."

    assert anonymous.get(f"{url}leaderboard/").status_code in (401, 403)
    move(admin, hackathon["slug"], "completed")
    assert anonymous.get(f"{url}leaderboard/").json()[0]["submission"]["title"] == "ClinicQueue"
    assert len(anonymous.get(f"{url}submissions/").json()) == 2
    assert judge.put(evaluate, scores(1, 1), format="json").status_code == 400  # results are final


def test_judging_needs_criteria(admin, org):
    response = admin.post("/api/hackathons/", hackathon_data(org), format="json")
    hackathon_slug = response.json()["slug"]
    move(admin, hackathon_slug, "published")
    blocked = admin.post(
        f"/api/hackathons/{hackathon_slug}/transition/", {"status": "judging"}, format="json"
    )
    assert blocked.status_code == 400


def test_challenges_belong_to_their_hackathon(admin, bob, org):
    first = create_hackathon(admin, org)
    second = create_hackathon(admin, org, title="Other")
    challenge = admin.post(
        f"/api/hackathons/{second['slug']}/challenges/", {"title": "Telemedicine"}, format="json"
    ).json()
    assert bob.post(
        f"/api/hackathons/{first['slug']}/challenges/", {"title": "Nope"}, format="json"
    ).status_code == 403
    bob.post(f"/api/hackathons/{first['slug']}/teams/", {"name": "Solo"}, format="json")
    wrong = bob.put(
        f"/api/hackathons/{first['slug']}/my-team/submission/",
        submission_data(challenge_id=challenge["id"]), format="json",
    )
    assert wrong.status_code == 400


def test_other_organizations_cannot_manage(admin, org, other_org):
    rival = sign_in("rita", admin_of=[other_org])
    hackathon = create_hackathon(admin, org)
    url = f"/api/hackathons/{hackathon['slug']}/"
    assert rival.patch(url, {"title": "Mine now"}, format="json").status_code == 403
    assert rival.get(f"{url}judges/").status_code == 403
    assert rival.post(f"{url}transition/", {"status": "cancelled"}, format="json").status_code == 403
    assert rival.post(f"{url}criteria/", {"name": "X"}, format="json").status_code == 403


def test_cancelled_hackathon_can_be_restored_to_open(admin, org):
    hackathon = create_hackathon(admin, org)
    cancelled = move(admin, hackathon["slug"], "cancelled")
    assert cancelled["cancelled_from"] == "published"
    restored = move(admin, hackathon["slug"], "published")
    assert restored["status"] == "published"
    assert restored["cancelled_from"] == ""
    assert restored["registration_open"] is True


def test_restore_returns_to_the_status_it_was_cancelled_from(admin, org):
    hackathon = create_hackathon(admin, org)
    move(admin, hackathon["slug"], "judging")
    move(admin, hackathon["slug"], "cancelled")
    url = f"/api/hackathons/{hackathon['slug']}/transition/"
    wrong = admin.post(url, {"status": "published"}, format="json")
    assert wrong.status_code == 400
    assert move(admin, hackathon["slug"], "judging")["status"] == "judging"


def test_only_managers_restore_a_hackathon(admin, bob, org):
    hackathon = create_hackathon(admin, org)
    move(admin, hackathon["slug"], "cancelled")
    url = f"/api/hackathons/{hackathon['slug']}/transition/"
    assert bob.post(url, {"status": "published"}, format="json").status_code == 403


def test_prizes_are_a_list_of_titles_and_values(admin, org):
    hackathon = create_hackathon(
        admin, org, publish=False,
        prizes=[
            {"title": " Winner ", "value": "KES 60,000"},
            {"title": "", "value": ""},
            {"title": "Runner-up", "value": "KES 30,000"},
        ],
    )
    assert hackathon["prizes"] == [
        {"title": "Winner", "value": "KES 60,000"},
        {"title": "Runner-up", "value": "KES 30,000"},
    ]
    url = f"/api/hackathons/{hackathon['slug']}/"
    updated = admin.patch(url, {"prizes": [{"title": "Best design", "value": "Laptop"}]}, format="json")
    assert updated.json()["prizes"] == [{"title": "Best design", "value": "Laptop"}]


def test_a_prize_needs_a_title(admin, org):
    response = admin.post(
        "/api/hackathons/", hackathon_data(org, prizes=[{"title": "", "value": "KES 10,000"}]), format="json"
    )
    assert response.status_code == 400
    assert "prizes" in response.json()


def test_hackathon_announcements(admin, bob, carol, anonymous, org):
    from django.core import mail

    hackathon = create_hackathon(admin, org)
    url = f"/api/hackathons/{hackathon['slug']}/"
    bob.post(f"{url}teams/", {"name": "Byte Me"}, format="json")
    assert admin.post(f"{url}judges/", {"email": "carol@example.com"}, format="json").status_code == 200
    mail.outbox.clear()

    note = {"title": "Kick-off moved", "body": "<p>Now at <b>10:00</b></p>"}
    assert bob.post(f"{url}announcements/", note, format="json").status_code == 403
    quiet = admin.post(f"{url}announcements/", note, format="json")
    assert quiet.status_code == 201 and mail.outbox == []

    loud = admin.post(f"{url}announcements/", {**note, "notify": True}, format="json")
    assert loud.json()["emailed_to"] == 2
    assert sorted(m.to[0] for m in mail.outbox) == ["bob@example.com", "carol@example.com"]

    listed = anonymous.get(f"{url}announcements/").json()
    assert [a["title"] for a in listed] == ["Kick-off moved", "Kick-off moved"]
    assert bob.delete(f"{url}announcements/{quiet.json()['id']}/").status_code == 403
    assert admin.delete(f"{url}announcements/{quiet.json()['id']}/").status_code == 204
    assert str(Announcement.objects.get()) == "Kick-off moved"


def test_platform_admins_see_and_manage_every_hackathon(admin, org, other_org):
    draft = create_hackathon(admin, org, publish=False)
    rival = sign_in("rita", admin_of=[other_org])
    theirs = create_hackathon(rival, other_org, title="Theirs")
    root = sign_in("root", platform_admin=True)
    listed = root.get("/api/hackathons/?scope=managed").json()["results"]
    assert {h["slug"] for h in listed} == {draft["slug"], theirs["slug"]}
    assert all(h["can_manage"] for h in listed)
    # An organisation's admins manage only their own.
    assert [h["slug"] for h in rival.get("/api/hackathons/?scope=managed").json()["results"]] == [theirs["slug"]]


def test_mine_is_empty_for_visitors(admin, anonymous, org):
    create_hackathon(admin, org)
    assert anonymous.get("/api/hackathons/?scope=mine").json()["count"] == 0
    assert anonymous.get("/api/hackathons/").json()["count"] == 1


def test_only_drafts_can_be_deleted(admin, bob, org):
    draft = create_hackathon(admin, org, publish=False)
    live = create_hackathon(admin, org, title="Live")
    assert bob.delete(f"/api/hackathons/{draft['slug']}/").status_code in (403, 404)
    refused = admin.delete(f"/api/hackathons/{live['slug']}/")
    assert refused.status_code == 400
    assert refused.json() == ["Only drafts can be deleted. Cancel a published hackathon instead."]
    assert admin.delete(f"/api/hackathons/{draft['slug']}/").status_code == 204
    assert list(Hackathon.objects.values_list("slug", flat=True)) == [live["slug"]]


def test_a_status_cannot_be_skipped(admin, org):
    hackathon = create_hackathon(admin, org, publish=False)
    response = admin.post(f"/api/hackathons/{hackathon['slug']}/transition/", {"status": "completed"}, format="json")
    assert response.status_code == 400
    assert response.json() == ["A hackathon that is draft cannot become completed."]
    assert Hackathon.objects.get().status == "draft"


def test_hackathon_details_are_checked(admin, org, other_org):
    def refused(**overrides):
        response = admin.post("/api/hackathons/", hackathon_data(org, **overrides), format="json")
        assert response.status_code == 400
        return response.json()

    assert refused(organization_id="org-missing") == {"organization_id": ["Unknown organisation."]}
    assert refused(ends_at=in_days(9)) == {"ends_at": ["The hackathon must end after it starts."]}
    assert refused(submission_deadline=in_days(9.5), registration_deadline=in_days(9)) == {
        "submission_deadline": ["Submissions cannot close before the hackathon starts."]
    }
    assert refused(prizes="KES 10,000") == {"prizes": ["Send prizes as a list."]}
    assert refused(prizes=["Winner"]) == {"prizes": ["Each prize needs a title and a value."]}
    assert refused(prizes=[{"title": "W" * 101, "value": "1"}]) == {
        "prizes": ["Keep prize titles and values under 100 characters."]
    }
    assert refused(prizes=[{"title": f"Prize {i}", "value": "1"} for i in range(21)]) == {
        "prizes": ["A hackathon can list at most 20 prizes."]
    }
    assert not Hackathon.objects.exists()

    hackathon = create_hackathon(admin, org, description="<p>Build</p><script>x()</script>")
    assert hackathon["description"] == "<p>Build</p>"
    root = sign_in("root", platform_admin=True)
    moved = root.patch(f"/api/hackathons/{hackathon['slug']}/", {"organization_id": other_org.id}, format="json")
    assert moved.status_code == 400
    assert moved.json() == {"organization_id": ["A hackathon cannot move to another organisation."]}
    assert str(Hackathon.objects.get()) == "Build for Health"


def test_a_member_leaves_and_the_leader_stays(admin, bob, carol, org):
    hackathon = create_hackathon(admin, org)
    url = f"/api/hackathons/{hackathon['slug']}/"
    code = bob.post(f"{url}teams/", {"name": "Byte Me"}, format="json").json()["invite_code"]
    carol.post(f"{url}teams/join/", {"invite_code": code}, format="json")
    assert carol.post(f"{url}my-team/leave/").status_code == 204
    members = bob.get(f"{url}my-team/").json()["members"]
    assert [(m["person"]["name"], m["is_leader"]) for m in members] == [("Bob", True)]
    assert str(Team.objects.get()) == "Byte Me"


def test_leaders_leave_rather_than_remove_themselves(admin, bob, carol, org):
    hackathon = create_hackathon(admin, org)
    url = f"/api/hackathons/{hackathon['slug']}/"
    code = bob.post(f"{url}teams/", {"name": "Byte Me"}, format="json").json()["invite_code"]
    members = carol.post(f"{url}teams/join/", {"invite_code": code}, format="json").json()["members"]
    bob_id, carol_id = members[0]["id"], members[1]["id"]
    myself = bob.delete(f"{url}my-team/members/{bob_id}/")
    assert myself.status_code == 400 and myself.json() == ["To go yourself, leave the team."]

    move(admin, hackathon["slug"], "judging")
    fixed = bob.delete(f"{url}my-team/members/{carol_id}/")
    assert fixed.status_code == 400 and fixed.json() == ["Teams are fixed once judging starts."]
    assert TeamMember.objects.count() == 2


def test_managers_list_and_remove_judges(admin, bob, org):
    hackathon = create_hackathon(admin, org)
    url = f"/api/hackathons/{hackathon['slug']}/judges/"
    sign_in("judy")
    admin.post(url, {"email": "judy@example.com"}, format="json")
    judges = admin.get(url).json()
    assert len(judges) == 1
    assert bob.delete(f"{url}{judges[0]['id']}/").status_code == 403
    assert admin.delete(f"{url}{judges[0]['id']}/").status_code == 204
    assert admin.get(url).json() == []
    assert admin.delete(f"{url}{judges[0]['id']}/").status_code == 404


def test_managers_edit_and_remove_challenges_and_criteria(admin, bob, org):
    hackathon = create_hackathon(admin, org)
    url = f"/api/hackathons/{hackathon['slug']}/"
    challenge = admin.post(f"{url}challenges/", {"title": "Telemedicine"}, format="json").json()
    renamed = admin.patch(f"{url}challenges/{challenge['id']}/", {"title": "Remote care"}, format="json")
    assert renamed.status_code == 200 and renamed.json()["title"] == "Remote care"
    assert str(Challenge.objects.get()) == "Remote care"
    assert bob.patch(f"{url}challenges/{challenge['id']}/", {"title": "Mine"}, format="json").status_code == 403
    assert admin.delete(f"{url}challenges/{challenge['id']}/").status_code == 204
    assert not Challenge.objects.exists()

    criterion = hackathon["criteria"][0]
    assert str(Criterion.objects.get(id=criterion["id"])) == "Innovation"
    assert admin.delete(f"{url}criteria/{criterion['id']}/").status_code == 204
    assert [c["name"] for c in admin.get(url).json()["criteria"]] == ["Execution"]


def test_a_submission_can_name_its_challenge(admin, bob, org):
    hackathon = create_hackathon(admin, org)
    url = f"/api/hackathons/{hackathon['slug']}/"
    challenge = admin.post(f"{url}challenges/", {"title": "Telemedicine"}, format="json").json()
    bob.post(f"{url}teams/", {"name": "Solo"}, format="json")
    submitted = bob.put(f"{url}my-team/submission/", submission_data(challenge_id=challenge["id"]), format="json")
    assert submitted.status_code == 200
    assert Submission.objects.get().challenge_id == challenge["id"]
    assert str(Submission.objects.get()) == "ClinicQueue"


@pytest.fixture
def judged(admin, bob, carol, org):
    """A hackathon being judged, with two submissions and a judge."""
    hackathon = create_hackathon(admin, org)
    url = f"/api/hackathons/{hackathon['slug']}/"
    for client, team, title in ((bob, "Byte Me", "ClinicQueue"), (carol, "Null Pointers", "MedTrack")):
        client.post(f"{url}teams/", {"name": team}, format="json")
        client.put(f"{url}my-team/submission/", submission_data(title=title), format="json")
    judge = sign_in("judy")
    admin.post(f"{url}judges/", {"email": "judy@example.com"}, format="json")
    move(admin, hackathon["slug"], "judging")
    criteria = [c["id"] for c in hackathon["criteria"]]
    for submission in Submission.objects.all():
        response = judge.put(
            f"{url}submissions/{submission.id}/evaluation/",
            {"scores": [{"criterion": c, "value": 7} for c in criteria], "comment": ""}, format="json",
        )
        assert response.status_code == 200, response.content
    return Hackathon.objects.get(slug=hackathon["slug"])


def test_equal_scores_share_a_rank(judged):
    assert [(row["rank"], row["score"]) for row in leaderboard(judged)] == [(1, 70.0), (1, 70.0)]


def test_without_weights_there_is_no_score(judged):
    Criterion.objects.update(weight=0)
    assert [(row["rank"], row["score"], row["evaluations"]) for row in leaderboard(judged)] == [
        (None, None, 0), (None, None, 0),
    ]
