from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone
from model_bakery import baker

from apps import slugs
from apps.accounts.models import RoleAssignment
from apps.events.models import Event, Registration
from apps.events.views import spans
from tests.conftest import sign_in

LINK = "https://meet.example.com/apis"
REGISTERED = Registration.Status.REGISTERED
WAITLISTED = Registration.Status.WAITLISTED
CANCELLED = Registration.Status.CANCELLED


def later(days):
    return timezone.now() + timedelta(days=days)


def make_event(org, **fields):
    return baker.make(Event, **{
        "organization": org,
        "title": "Intro to APIs",
        "slug": "",  # the model makes it from the title
        "status": Event.Status.PUBLISHED,
        "delivery_mode": Event.Mode.HYBRID,
        "venue": "Lab 3",
        "starts_at": later(7),
        "ends_at": later(7.1),
        "online_url": LINK,
        **fields,
    })


def event_data(org, **overrides):
    return {
        "organization_id": org.id,
        "title": "Intro to APIs",
        "description": "<p>Bring a <b>laptop</b>.</p>",
        "event_type": "workshop",
        "delivery_mode": "hybrid",
        "venue": "Lab 3",
        "online_url": LINK,
        "starts_at": later(7),
        "ends_at": later(7.1),
        **overrides,
    }


def statuses():
    return dict(Registration.objects.values_list("profile__full_name", "status"))


@pytest.fixture
def event(org):
    return make_event(org)


def test_those_who_manage_the_organisation_create_events(admin, bob, org, other_org):
    url = reverse("event-list")
    assert bob.post(url, event_data(org), format="json").status_code == 403
    assert admin.post(url, event_data(other_org), format="json").status_code == 403

    created = admin.post(url, event_data(org), format="json")
    assert created.status_code == 201
    assert created.json()["status"] == "draft"
    assert created.json()["can_manage"] is True
    assert created.json()["attendee_preview"] == []
    assert "id" not in created.json()

    # An event organiser may too, without becoming a hackathon manager.
    baker.make(RoleAssignment, profile=bob.profile, organization=org, role=RoleAssignment.Role.EVENT_ORGANISER)
    assert bob.post(url, event_data(org), format="json").status_code == 201
    assert bob.get(reverse("me")).json()["organizations"][0]["can_manage_hackathons"] is False


@pytest.mark.parametrize(
    "overrides, errors",
    [
        ({"ends_at": later(6)}, {"ends_at": ["The event must end after it starts."]}),
        ({"organization_id": "org-missing"}, {"organization_id": ["Unknown organisation."]}),
        (
            {"registration_deadline": later(8)},
            {"registration_deadline": ["Registration must close before the event ends."]},
        ),
        (
            {"online_url": "http://meet.google.com/x"},
            {"online_url": ["Use the https:// link your meeting tool gives you."]},
        ),
    ],
)
def test_event_details_are_checked(admin, org, overrides, errors):
    response = admin.post(reverse("event-list"), event_data(org, **overrides), format="json")
    assert response.status_code == 400
    assert response.json() == errors


def test_an_event_keeps_its_slug_and_its_organisation(org, other_org, monkeypatch):
    codes = iter("aaaaaa" "aaaaaa" "bbbbbb")
    monkeypatch.setattr(slugs.secrets, "choice", lambda alphabet: next(codes))
    event = make_event(org, title="React Workshop: Nairobi!")
    twin = make_event(org, title="React Workshop: Nairobi!")
    assert (event.slug, twin.slug) == ("react-workshop-nairobi-aaaaaa", "react-workshop-nairobi-bbbbbb")

    both = sign_in("olive", admin_of=[org, other_org])
    url = reverse("event-detail", args=[event.slug])
    renamed = both.patch(url, {"organization_id": org.id, "title": "Renamed"}, format="json")
    assert renamed.json()["slug"] == event.slug
    moved = both.patch(url, {"organization_id": other_org.id}, format="json")
    assert moved.status_code == 400
    assert moved.json() == {"organization_id": ["An event cannot move to another organisation."]}
    event.refresh_from_db()
    assert event.organization_id == org.id
    assert str(event) == "Renamed"
    assert both.get(reverse("event-detail", args=[event.pk])).status_code == 404


def test_drafts_stay_with_their_organisers_until_published(admin, bob, anonymous, org):
    draft = make_event(org, status=Event.Status.DRAFT)
    url = reverse("event-detail", args=[draft.slug])
    assert anonymous.get(url).status_code == 404
    assert bob.get(url).status_code == 404
    assert admin.get(url).json()["can_manage"] is True
    assert anonymous.get(reverse("event-list")).json()["count"] == 0

    publish = admin.post(reverse("event-transition", args=[draft.slug]), {"status": "published"}, format="json")
    assert publish.status_code == 200
    assert bob.get(url).json()["can_manage"] is False
    assert anonymous.get(reverse("event-list")).json()["count"] == 1


@pytest.mark.parametrize(
    "current, target, status_code",
    [
        ("draft", "published", 200),
        ("published", "draft", 400),
        ("published", "completed", 200),
        ("published", "cancelled", 200),
        ("completed", "cancelled", 400),
    ],
)
def test_an_event_moves_only_forward(admin, org, current, target, status_code):
    event = make_event(org, status=current)
    response = admin.post(reverse("event-transition", args=[event.slug]), {"status": target}, format="json")
    assert response.status_code == status_code


@pytest.mark.parametrize(
    "method, route, data",
    [
        ("patch", "event-detail", {"title": "Hijacked"}),
        ("delete", "event-detail", None),
        ("post", "event-transition", {"status": "cancelled"}),
        ("get", "event-registrations", None),
        ("get", "event-stats", None),
        ("get", "event-feedback", None),
        ("post", "event-check-in", {"registration": 1}),
        ("delete", "event-check-in", None),
        ("post", "event-announcements", {"title": "Hi", "body": "x"}),
        ("post", "event-resources", {"title": "Slides", "url": "https://example.com/slides"}),
    ],
)
def test_only_organisers_manage_an_event(bob, event, method, route, data):
    response = getattr(bob, method)(reverse(route, args=[event.slug]), data, format="json")
    assert response.status_code == 403


@pytest.mark.parametrize("status, status_code", [("draft", 204), ("published", 400)])
def test_only_drafts_can_be_deleted(admin, org, status, status_code):
    event = make_event(org, status=status)
    assert admin.delete(reverse("event-detail", args=[event.slug])).status_code == status_code


def test_members_register_cancel_and_register_again(admin, bob, anonymous, event):
    url = reverse("event-register", args=[event.slug])
    mine = f"{reverse('event-list')}?scope=mine"
    assert anonymous.post(url).status_code == 401
    assert bob.delete(url).json() == ["You are not registered for this event."]

    registered = bob.post(url).json()
    assert registered["my_registration"]["status"] == "registered"
    assert registered["registered_count"] == 1
    assert bob.post(url).json() == ["You are already registered for this event."]

    assert bob.delete(url).json()["my_registration"]["status"] == "cancelled"
    assert bob.delete(url).status_code == 400
    assert bob.post(url).json()["my_registration"]["status"] == "registered"

    assert bob.get(mine).json()["count"] == 1
    assert admin.get(mine).json()["count"] == 0
    assert anonymous.get(mine).json()["count"] == 0


def test_a_freed_place_goes_to_the_next_person_waiting(bob, carol, org):
    event = make_event(org, capacity=1)
    url = reverse("event-register", args=[event.slug])
    assert bob.post(url).json()["my_registration"]["status"] == "registered"
    waiting = carol.post(url).json()
    assert waiting["my_registration"]["status"] == "waitlisted"
    assert waiting["spots_left"] == 0
    sign_in("dan").post(url)

    carol.delete(url)  # leaving the waiting list frees no place
    assert statuses() == {"Bob": "registered", "Carol": "cancelled", "Dan": "waitlisted"}
    bob.delete(url)
    assert statuses() == {"Bob": "cancelled", "Carol": "cancelled", "Dan": "registered"}


def test_registration_closes_at_the_deadline_and_nobody_is_promoted_after_it(bob, carol, org):
    event = make_event(org, capacity=1, registration_deadline=later(-1))
    baker.make(Registration, event=event, profile=bob.profile)
    baker.make(Registration, event=event, profile=carol.profile, status=WAITLISTED)
    url = reverse("event-register", args=[event.slug])
    assert sign_in("dan").post(url).json() == ["Registration for this event is closed."]
    assert bob.delete(url).status_code == 200
    assert statuses() == {"Bob": "cancelled", "Carol": "waitlisted"}


def test_the_join_link_is_only_for_people_who_are_coming(admin, bob, carol, anonymous, event):
    baker.make(Registration, event=event, profile=bob.profile)
    baker.make(Registration, event=event, profile=carol.profile, status=WAITLISTED)
    url = reverse("event-detail", args=[event.slug])
    assert anonymous.get(url).json()["online_url"] == ""
    assert carol.get(url).json()["online_url"] == ""
    assert bob.get(url).json()["online_url"] == LINK
    assert admin.get(url).json()["online_url"] == LINK


@pytest.mark.parametrize(
    "online_url, provider",
    [
        ("https://us02web.zoom.us/j/123?pwd=x", {"id": "zoom", "name": "Zoom"}),
        ("https://teams.microsoft.com/l/meetup-join/19%3ameeting", {"id": "teams", "name": "Microsoft Teams"}),
        ("https://example.com/room", None),
    ],
)
def test_everyone_sees_which_service_hosts_the_meeting(admin, bob, anonymous, org, online_url, provider):
    event = make_event(org, delivery_mode=Event.Mode.ONLINE)
    baker.make(Registration, event=event, profile=bob.profile)  # is told of the new link
    url = reverse("event-detail", args=[event.slug])
    assert admin.patch(url, {"online_url": online_url}, format="json").status_code == 200
    assert anonymous.get(url).json()["meeting_provider"] == provider


def test_lists_show_who_is_going_by_initials_only(bob, carol, anonymous, org):
    event = make_event(org, cover_image="https://example.com/banner.png")
    baker.make(Registration, event=event, profile=bob.profile)
    baker.make(Registration, event=event, profile=carol.profile)
    listed = anonymous.get(reverse("event-list")).json()["results"][0]
    assert listed["cover_image"] == "https://example.com/banner.png"
    assert listed["attendee_preview"] == ["B", "C"]
    assert listed["registered_count"] == 2


@pytest.fixture
def calendar(org):
    start, end = spans()["today"]
    make_event(org, title="Tonight", starts_at=start + (end - start) / 2, ends_at=end)
    make_event(org, title="Next month", starts_at=later(30), ends_at=later(30.1))
    make_event(org, title="Over", starts_at=later(-2), ends_at=later(-1))
    make_event(org, title="Long over", starts_at=later(-9), ends_at=later(-8))


@pytest.mark.parametrize(
    "query, titles",
    [
        ("within=today", ["Tonight"]),
        ("within=whenever", ["Long over", "Over", "Tonight", "Next month"]),
        ("when=upcoming", ["Tonight", "Next month"]),
        ("when=past", ["Over", "Long over"]),  # most recent first
    ],
)
def test_events_are_found_by_when_they_happen(anonymous, calendar, query, titles):
    results = anonymous.get(f"{reverse('event-list')}?{query}").json()["results"]
    assert [e["title"] for e in results] == titles


def test_organisers_check_people_in_by_ticket_or_from_the_list(admin, bob, carol, event, org):
    ticket = baker.make(Registration, event=event, profile=bob.profile)
    listed = baker.make(Registration, event=event, profile=carol.profile)
    url = reverse("event-check-in", args=[event.slug])
    scan = {"ticket_code": str(ticket.ticket_code)}

    elsewhere = reverse("event-check-in", args=[make_event(org, title="Other event").slug])
    assert admin.post(elsewhere, scan, format="json").status_code == 404
    assert admin.post(url, {}, format="json").json() == {
        "non_field_errors": ["Send a ticket code or a registration."]
    }

    first = admin.post(url, scan, format="json").json()
    assert first["already_checked_in"] is False
    assert first["person"]["name"] == "Bob"
    assert admin.post(url, scan, format="json").json()["already_checked_in"] is True
    assert admin.post(url, {"registration": listed.id}, format="json").status_code == 200

    stats = admin.get(reverse("event-stats", args=[event.slug])).json()
    assert (stats["registered"], stats["checked_in"], stats["attendance_rate"]) == (2, 2, 1.0)
    registrations = admin.get(reverse("event-registrations", args=[event.slug])).json()
    assert (registrations[0]["email"], registrations[0]["status"]) == ("bob@example.com", "registered")
    assert str(ticket) == "Bob at Intro to APIs"
    # Someone who attended cannot cancel.
    assert bob.delete(reverse("event-register", args=[event.slug])).status_code == 400

    undone = admin.delete(f"{url}?registration={listed.id}")
    assert undone.json()["checked_in_at"] is None
    listed.refresh_from_db()
    assert listed.checked_in_by is None
    assert admin.delete(f"{url}?registration=999999").status_code == 404


@pytest.mark.parametrize(
    "registration_status, event_status, error",
    [
        (CANCELLED, Event.Status.PUBLISHED, "This registration is cancelled."),
        (REGISTERED, Event.Status.CANCELLED, "Check-in is only open for published events."),
    ],
)
def test_check_in_needs_a_live_registration_and_event(admin, org, bob, registration_status, event_status, error):
    event = make_event(org, status=event_status)
    registration = baker.make(Registration, event=event, profile=bob.profile, status=registration_status)
    response = admin.post(
        reverse("event-check-in", args=[event.slug]), {"ticket_code": str(registration.ticket_code)}, format="json"
    )
    assert response.json() == [error]
    registration.refresh_from_db()
    assert registration.checked_in_at is None


def test_feedback_and_certificates_are_for_attendees(admin, bob, carol, anonymous, event):
    attended = baker.make(Registration, event=event, profile=bob.profile, checked_in_at=timezone.now())
    absent = baker.make(Registration, event=event, profile=carol.profile)
    feedback = reverse("event-feedback", args=[event.slug])
    assert carol.post(feedback, {"rating": 5}, format="json").status_code == 403
    assert bob.post(feedback, {"rating": 6}, format="json").status_code == 400
    assert bob.post(feedback, {"rating": 4, "comment": "Good"}, format="json").status_code == 200
    assert bob.post(feedback, {"rating": 5}, format="json").status_code == 200  # revised
    assert bob.get(feedback).status_code == 403
    assert admin.get(feedback).json()[0]["rating"] == 5
    assert admin.get(reverse("event-stats", args=[event.slug])).json()["average_rating"] == 5

    certificate = reverse("event-certificate", args=[event.slug])
    assert bob.get(certificate).status_code == 404  # not until the event is over
    event.status = Event.Status.COMPLETED
    event.save()
    assert bob.get(certificate).json()["recipient"] == "Bob"
    assert carol.get(certificate).status_code == 404

    verified = anonymous.get(reverse("certificate", args=[attended.certificate_code]))
    assert verified.json()["event"] == "Intro to APIs"
    assert anonymous.get(reverse("certificate", args=[absent.certificate_code])).status_code == 404
    assert anonymous.get(reverse("certificate", args=[attended.ticket_code])).status_code == 404


@pytest.mark.parametrize("notify, emailed_to", [(True, 1), (False, None)])
def test_organisers_post_announcements_and_resources_that_anyone_reads(
    admin, bob, anonymous, event, notify, emailed_to
):
    baker.make(Registration, event=event, profile=bob.profile)
    announcements = reverse("event-announcements", args=[event.slug])
    resources = reverse("event-resources", args=[event.slug])
    note = {"title": "Bring a laptop", "body": "And a charger.", "notify": notify}
    created = admin.post(announcements, note, format="json")
    assert created.json().get("emailed_to") == emailed_to
    link = {"title": "Slides", "url": "https://example.com/slides"}
    assert admin.post(resources, link, format="json").status_code == 201

    assert anonymous.get(announcements).json()[0]["title"] == "Bring a laptop"
    assert anonymous.get(resources).json()[0]["title"] == "Slides"
    one = reverse("event-announcement", args=[event.slug, created.json()["id"]])
    assert bob.delete(one).status_code == 403
    assert admin.delete(one).status_code == 204


def test_calendar_invites_share_the_join_link_only_on_tickets(bob, org):
    event = make_event(
        org, delivery_mode="online", online_url="https://meet.google.com/abc-defg-hij",
        description="<p>Bring a <b>laptop</b>.</p>",
    )
    registration = baker.make(Registration, event=event, profile=bob.profile)
    unfold = lambda response: response.content.decode().replace("\r\n ", "")  # .ics wraps long lines
    public = bob.get(reverse("event-calendar", args=[event.slug]))
    assert public["Content-Type"].startswith("text/calendar")
    body = unfold(public)
    assert "SUMMARY:Intro to APIs" in body
    assert "STATUS:CONFIRMED" in body
    assert f"UID:event-{event.slug}@community.amilliontechies.com" in body
    assert "Online (Google Meet)" in body
    assert "meet.google.com" not in body

    personal = unfold(bob.get(reverse("ticket-calendar", args=[registration.ticket_code])))
    assert "meet.google.com/abc-defg-hij" in personal
    assert "Bring a laptop." in personal

    draft = make_event(org, status=Event.Status.DRAFT)
    assert bob.get(reverse("event-calendar", args=[draft.slug])).status_code == 404
