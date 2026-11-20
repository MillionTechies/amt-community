from datetime import timedelta

from django.utils import timezone

from apps.hackathons.models import Hackathon
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
