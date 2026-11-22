"""An organisation's admins and organisers see only their own organisation's management data."""

import pytest

from tests.conftest import sign_in
from tests.test_events import create_event
from tests.test_hackathons import create_hackathon


@pytest.fixture
def theirs(other_org):
    """UoN's admin runs a published event and hackathon, plus drafts of each."""
    uon = sign_in("una", admin_of=[other_org])
    return {
        "event": create_event(uon, other_org)["slug"],
        "draft_event": create_event(uon, other_org, publish=False, title="Secret plan")["slug"],
        "hackathon": create_hackathon(uon, other_org)["slug"],
        "draft_hackathon": create_hackathon(uon, other_org, publish=False, title="Secret jam")["slug"],
    }


MANAGEMENT = [
    "/api/events/{event}/registrations/",
    "/api/events/{event}/stats/",
    "/api/events/{event}/links/",
    "/api/hackathons/{hackathon}/judges/",
    "/api/hackathons/{hackathon}/teams/",
    "/api/events/{draft_event}/",
    "/api/hackathons/{draft_hackathon}/",
    "/api/organizations/org-uon/roles/",
]


@pytest.mark.parametrize("path", MANAGEMENT)
def test_another_organisations_admin_is_refused(admin, theirs, path):
    response = admin.get(path.format(**theirs))
    assert response.status_code in (403, 404), (path, response.status_code, response.content[:300])


def test_console_lists_show_only_your_organisation(admin, org, theirs):
    create_event(admin, org, title="Our meetup")
    for path in ("/api/events/?scope=managed", "/api/hackathons/?scope=managed"):
        body = admin.get(path).json()
        rows = body["results"] if isinstance(body, dict) else body
        assert {r["organization"]["id"] for r in rows} <= {org.id}, path


def test_me_lists_only_your_organisations(admin, org, theirs):
    assert [o["id"] for o in admin.get("/api/me/").json()["organizations"]] == [org.id]
