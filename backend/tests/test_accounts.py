from tests.conftest import make_org, sign_in


def test_me_requires_sign_in(anonymous):
    assert anonymous.get("/api/me/").status_code in (401, 403)


def test_me_reports_what_the_member_manages(admin, bob, org):
    me = admin.get("/api/me/").json()
    assert me["email"] == "alice@example.com"
    assert me["organizations"] == [
        {
            "id": org.id, "name": "JKUAT", "alias": "jkuat", "is_admin": True, "roles": [],
            "can_manage_events": True, "can_manage_hackathons": True,
        }
    ]
    assert bob.get("/api/me/").json()["organizations"] == []


def test_me_adds_an_organization_the_mirror_has_not_seen_yet():
    org = make_org("new")
    client = sign_in("dan", member_of=[org])
    org.delete()
    me = client.get("/api/me/").json()
    assert me["organizations"][0]["alias"] == "new"


def test_member_edits_own_profile(bob):
    response = bob.patch(
        "/api/me/", {"headline": "Backend dev", "skills": ["Python", " Go "], "email": "x@y.z"},
        format="json",
    )
    assert response.status_code == 200
    body = response.json()
    assert body["headline"] == "Backend dev"
    assert body["skills"] == ["Python", "Go"]
    assert body["email"] == "bob@example.com"  # identity fields follow Keycloak


def test_org_admin_grants_a_scoped_role(admin, bob, org, other_org):
    url = f"/api/organizations/{org.id}/roles/"
    granted = admin.post(url, {"email": "bob@example.com", "role": "event_organiser"}, format="json")
    assert granted.status_code == 201
    mine = bob.get("/api/me/").json()["organizations"]
    assert [(o["alias"], o["can_manage_events"], o["can_manage_hackathons"]) for o in mine] == [
        ("jkuat", True, False)
    ]
    # The role does not reach into another organization.
    assert bob.get(f"/api/organizations/{other_org.id}/roles/").status_code == 403
    assert admin.get(f"/api/organizations/{other_org.id}/roles/").status_code == 403

    assert admin.delete(f"{url}{granted.json()['id']}/").status_code == 204
    assert bob.get("/api/me/").json()["organizations"] == []


def test_role_needs_a_member_who_has_signed_in(admin, org):
    response = admin.post(
        f"/api/organizations/{org.id}/roles/",
        {"email": "nobody@example.com", "role": "event_organiser"}, format="json",
    )
    assert response.status_code == 400


def test_platform_admin_manages_every_organization(org, other_org):
    root = sign_in("root", platform_admin=True)
    me = root.get("/api/me/").json()
    assert me["is_platform_admin"] is True
    assert {o["alias"] for o in me["organizations"] if o["can_manage_events"]} == {"jkuat", "uon"}
    assert root.get(f"/api/organizations/{other_org.id}/roles/").status_code == 200
