from datetime import timedelta

from django.utils import timezone

from apps.events.models import Event, Registration
from tests.conftest import in_days, sign_in


def event_data(org, **overrides):
    return {
        "organization_id": org.id,
        "title": "Intro to APIs",
        "event_type": "workshop",
        "delivery_mode": "hybrid",
        "venue": "Lab 3",
        "online_url": "https://meet.example.com/apis",
        "starts_at": in_days(7),
        "ends_at": in_days(7.1),
        **overrides,
    }


def create_event(client, org, publish=True, **overrides):
    response = client.post("/api/events/", event_data(org, **overrides), format="json")
    assert response.status_code == 201, response.content
    event = response.json()
    if publish:
        response = client.post(
            f"/api/events/{event['slug']}/transition/", {"status": "published"}, format="json"
        )
        assert response.status_code == 200, response.content
        event = response.json()
    return event


def test_only_those_who_manage_the_organization_create_events(admin, bob, org, other_org):
    assert bob.post("/api/events/", event_data(org), format="json").status_code == 403
    assert admin.post("/api/events/", event_data(other_org), format="json").status_code == 403
    assert admin.post("/api/events/", event_data(org), format="json").status_code == 201


def test_event_organiser_role_is_enough(admin, bob, org):
    admin.post(
        f"/api/organizations/{org.id}/roles/",
        {"email": "bob@example.com", "role": "event_organiser"}, format="json",
    )
    assert bob.post("/api/events/", event_data(org), format="json").status_code == 201
    # ...but it is not the hackathon manager role.
    assert bob.get("/api/me/").json()["organizations"][0]["can_manage_hackathons"] is False


def test_event_must_end_after_it_starts(admin, org):
    response = admin.post(
        "/api/events/", event_data(org, ends_at=in_days(6)), format="json"
    )
    assert response.status_code == 400
    assert "ends_at" in response.json()


def test_drafts_are_hidden_until_published(admin, bob, anonymous, org):
    event = create_event(admin, org, publish=False)
    url = f"/api/events/{event['slug']}/"
    assert anonymous.get(url).status_code == 404
    assert bob.get(url).status_code == 404
    assert admin.get(url).json()["can_manage"] is True
    assert anonymous.get("/api/events/").json()["count"] == 0

    admin.post(f"{url}transition/", {"status": "published"}, format="json")
    assert anonymous.get(url).status_code == 200
    assert bob.get(url).json()["can_manage"] is False
    assert anonymous.get("/api/events/").json()["count"] == 1


def test_status_moves_only_forward(admin, org):
    event = create_event(admin, org)
    url = f"/api/events/{event['slug']}/transition/"
    assert admin.post(url, {"status": "draft"}, format="json").status_code == 400
    assert admin.post(url, {"status": "completed"}, format="json").status_code == 200
    assert admin.post(url, {"status": "cancelled"}, format="json").status_code == 400


def test_others_cannot_edit_or_publish(admin, bob, org):
    event = create_event(admin, org, publish=False)
    url = f"/api/events/{event['slug']}/"
    admin.post(f"{url}transition/", {"status": "published"}, format="json")
    assert bob.patch(url, {"title": "Hijacked"}, format="json").status_code == 403
    assert bob.post(f"{url}transition/", {"status": "cancelled"}, format="json").status_code == 403
    assert bob.get(f"{url}registrations/").status_code == 403
    assert bob.get(f"{url}stats/").status_code == 403


def test_register_and_cancel(admin, bob, anonymous, org):
    event = create_event(admin, org)
    url = f"/api/events/{event['slug']}/register/"
    assert anonymous.post(url).status_code in (401, 403)

    body = bob.post(url).json()
    assert body["my_registration"]["status"] == "registered"
    assert body["registered_count"] == 1
    assert bob.post(url).status_code == 400  # already registered

    assert bob.delete(url).json()["my_registration"]["status"] == "cancelled"
    assert bob.post(url).json()["my_registration"]["status"] == "registered"
    assert bob.get("/api/events/?scope=mine").json()["count"] == 1
    assert admin.get("/api/events/?scope=mine").json()["count"] == 0


def test_join_link_is_only_for_people_who_are_coming(admin, bob, anonymous, org):
    event = create_event(admin, org)
    url = f"/api/events/{event['slug']}/"
    assert anonymous.get(url).json()["online_url"] == ""
    assert bob.get(url).json()["online_url"] == ""
    bob.post(f"{url}register/")
    assert bob.get(url).json()["online_url"] == "https://meet.example.com/apis"
    assert admin.get(url).json()["online_url"] == "https://meet.example.com/apis"


def test_full_event_waitlists_then_promotes(admin, bob, carol, org):
    event = create_event(admin, org, capacity=1)
    url = f"/api/events/{event['slug']}/register/"
    assert bob.post(url).json()["my_registration"]["status"] == "registered"
    waiting = carol.post(url).json()
    assert waiting["my_registration"]["status"] == "waitlisted"
    assert waiting["spots_left"] == 0

    bob.delete(url)  # bob frees the place, carol gets it
    assert carol.get(f"/api/events/{event['slug']}/").json()["my_registration"]["status"] == (
        "registered"
    )


def test_registration_closes_at_the_deadline(admin, bob, org):
    event = create_event(admin, org, registration_deadline=in_days(1))
    Event.objects.filter(slug=event["slug"]).update(
        registration_deadline=timezone.now() - timedelta(hours=1)
    )
    assert bob.post(f"/api/events/{event['slug']}/register/").status_code == 400


def test_qr_check_in(admin, bob, carol, org):
    event = create_event(admin, org)
    other = create_event(admin, org, title="Other event")
    url = f"/api/events/{event['slug']}/"
    ticket = bob.post(f"{url}register/").json()["my_registration"]["ticket_code"]

    # Attendees cannot check themselves in, and a ticket only works at its own event.
    assert bob.post(f"{url}check-in/", {"ticket_code": ticket}, format="json").status_code == 403
    wrong = admin.post(
        f"/api/events/{other['slug']}/check-in/", {"ticket_code": ticket}, format="json"
    )
    assert wrong.status_code == 404

    first = admin.post(f"{url}check-in/", {"ticket_code": ticket}, format="json")
    assert first.status_code == 200
    assert first.json()["already_checked_in"] is False
    assert first.json()["person"]["name"] == "Bob"
    again = admin.post(f"{url}check-in/", {"ticket_code": ticket}, format="json")
    assert again.json()["already_checked_in"] is True

    # Organisers can also tick someone on the list.
    carol.post(f"{url}register/")
    registration = Registration.objects.get(event__slug=event["slug"], profile=carol.profile)
    by_list = admin.post(f"{url}check-in/", {"registration": registration.id}, format="json")
    assert by_list.status_code == 200

    stats = admin.get(f"{url}stats/").json()
    assert (stats["registered"], stats["checked_in"], stats["attendance_rate"]) == (2, 2, 1.0)
    assert bob.delete(f"{url}register/").status_code == 400  # already attended


def test_cancelled_registration_cannot_check_in(admin, bob, org):
    event = create_event(admin, org)
    url = f"/api/events/{event['slug']}/"
    ticket = bob.post(f"{url}register/").json()["my_registration"]["ticket_code"]
    bob.delete(f"{url}register/")
    assert admin.post(f"{url}check-in/", {"ticket_code": ticket}, format="json").status_code == 400


def test_feedback_and_certificate_are_for_attendees(admin, bob, carol, anonymous, org):
    event = create_event(admin, org)
    url = f"/api/events/{event['slug']}/"
    ticket = bob.post(f"{url}register/").json()["my_registration"]["ticket_code"]
    carol.post(f"{url}register/")  # registers but never shows up
    admin.post(f"{url}check-in/", {"ticket_code": ticket}, format="json")

    assert carol.post(f"{url}feedback/", {"rating": 5}, format="json").status_code == 403
    assert bob.post(f"{url}feedback/", {"rating": 6}, format="json").status_code == 400
    assert bob.post(f"{url}feedback/", {"rating": 4, "comment": "Good"}, format="json").status_code == 200
    assert bob.post(f"{url}feedback/", {"rating": 5}, format="json").status_code == 200  # revised
    assert bob.get(f"{url}feedback/").status_code == 403
    assert [f["rating"] for f in admin.get(f"{url}feedback/").json()] == [5]
    assert admin.get(f"{url}stats/").json()["average_rating"] == 5

    # No certificate until the event is over.
    assert bob.get(f"{url}certificate/").status_code == 404
    admin.post(f"{url}transition/", {"status": "completed"}, format="json")
    certificate = bob.get(f"{url}certificate/").json()
    assert certificate["recipient"] == "Bob"
    assert carol.get(f"{url}certificate/").status_code == 404

    verified = anonymous.get(f"/api/certificates/{certificate['certificate_code']}/")
    assert verified.status_code == 200
    assert verified.json()["event"] == "Intro to APIs"
    assert anonymous.get(f"/api/certificates/{ticket}/").status_code == 404


def test_announcements_and_resources(admin, bob, anonymous, org):
    event = create_event(admin, org)
    url = f"/api/events/{event['slug']}/"
    note = {"title": "Bring a laptop", "body": "And a charger."}
    assert bob.post(f"{url}announcements/", note, format="json").status_code == 403
    created = admin.post(f"{url}announcements/", note, format="json")
    assert created.status_code == 201
    link = {"title": "Slides", "url": "https://example.com/slides"}
    assert admin.post(f"{url}resources/", link, format="json").status_code == 201

    assert [a["title"] for a in anonymous.get(f"{url}announcements/").json()] == ["Bring a laptop"]
    assert [r["title"] for r in anonymous.get(f"{url}resources/").json()] == ["Slides"]
    assert bob.delete(f"{url}announcements/{created.json()['id']}/").status_code == 403
    assert admin.delete(f"{url}announcements/{created.json()['id']}/").status_code == 204


def test_organizations_do_not_see_each_others_drafts(admin, org, other_org):
    rival = sign_in("rita", admin_of=[other_org])
    event = create_event(admin, org, publish=False)
    assert rival.get(f"/api/events/{event['slug']}/").status_code == 404
    assert rival.get("/api/events/?scope=managed").json()["count"] == 0
    assert admin.get("/api/events/?scope=managed").json()["count"] == 1


def test_only_drafts_can_be_deleted(admin, org):
    draft = create_event(admin, org, publish=False)
    live = create_event(admin, org)
    assert admin.delete(f"/api/events/{draft['slug']}/").status_code == 204
    assert admin.delete(f"/api/events/{live['slug']}/").status_code == 400


def test_events_are_addressed_by_a_slug_that_survives_renaming(admin, org):
    first = create_event(admin, org, title="React Workshop: Nairobi!")
    second = create_event(admin, org, title="React Workshop: Nairobi!")
    assert "id" not in first
    assert first["slug"].startswith("react-workshop-nairobi-")
    assert len(first["slug"]) == len("react-workshop-nairobi-") + 6
    assert first["slug"] != second["slug"]

    url = f"/api/events/{first['slug']}/"
    assert admin.patch(url, {"title": "Renamed"}, format="json").json()["slug"] == first["slug"]
    assert admin.get(f"/api/events/{Event.objects.get(slug=first['slug']).pk}/").status_code == 404


def test_meeting_links_name_their_service(admin, bob, org):
    event = create_event(
        admin, org, delivery_mode="online", venue="",
        online_url="https://us02web.zoom.us/j/123?pwd=x",
    )
    assert event["meeting_provider"] == {"id": "zoom", "name": "Zoom"}
    # Someone not registered sees the service but not the link.
    seen = bob.get(f"/api/events/{event['slug']}/").json()
    assert seen["meeting_provider"]["name"] == "Zoom" and seen["online_url"] == ""

    url = f"/api/events/{event['slug']}/"
    teams = "https://teams.microsoft.com/l/meetup-join/19%3ameeting"
    assert admin.patch(url, {"online_url": teams}, format="json").json()["meeting_provider"]["id"] == "teams"
    other = admin.patch(url, {"online_url": "https://example.com/room"}, format="json").json()
    assert other["meeting_provider"] is None
    assert admin.patch(url, {"online_url": "http://meet.google.com/x"}, format="json").status_code == 400


def test_calendar_invites(admin, bob, org):
    event = create_event(
        admin, org, title="Intro to APIs", delivery_mode="online", venue="",
        online_url="https://meet.google.com/abc-defg-hij", description="<p>Bring a <b>laptop</b>.</p>",
    )
    public = bob.get(f"/api/events/{event['slug']}/calendar.ics")
    assert public.status_code == 200 and public["Content-Type"].startswith("text/calendar")
    unfold = lambda text: text.replace("\r\n ", "")  # .ics wraps lines at 75 characters
    body = unfold(public.content.decode())
    assert "SUMMARY:Intro to APIs" in body and "STATUS:CONFIRMED" in body
    assert f"UID:event-{event['slug']}@community.amilliontechies.com" in body
    assert "meet.google.com" not in body and "Online (Google Meet)" in body

    bob.post(f"/api/events/{event['slug']}/register/")
    ticket = bob.get(f"/api/events/{event['slug']}/").json()["my_registration"]["ticket_code"]
    personal = unfold(bob.get(f"/api/tickets/{ticket}/calendar.ics").content.decode())
    assert "meet.google.com/abc-defg-hij" in personal and "Bring a laptop." in personal

    draft = create_event(admin, org, publish=False)
    assert bob.get(f"/api/events/{draft['slug']}/calendar.ics").status_code == 404


def test_cover_image_and_who_is_going(admin, bob, carol, anonymous, org):
    event = create_event(admin, org, cover_image="https://example.com/banner.png")
    assert event["cover_image"] == "https://example.com/banner.png"
    assert event["attendee_preview"] == []
    for person in (bob, carol):
        person.post(f"/api/events/{event['slug']}/register/")
    listed = anonymous.get("/api/events/").json()["results"][0]
    # Initials only, in sign-up order: names stay off the public list.
    assert listed["attendee_preview"] == ["B", "C"]
    assert listed["registered_count"] == 2


def test_events_happening_today(admin, anonymous, org):
    from apps.events.views import spans

    start, end = spans()["today"]
    soon = create_event(admin, org, title="Tonight", starts_at=start + (end - start) / 2, ends_at=end)
    create_event(admin, org, title="Next month", starts_at=in_days(30), ends_at=in_days(30.1))
    today = anonymous.get("/api/events/?within=today").json()["results"]
    assert [e["slug"] for e in today] == [soon["slug"]]
    assert len(anonymous.get("/api/events/?within=whenever").json()["results"]) == 2


def slugs(response):
    return [e["slug"] for e in response.json()["results"]]


def test_upcoming_and_past_events(admin, anonymous, org):
    later = create_event(admin, org, title="Later")
    earlier = create_event(admin, org, title="Earlier")
    over = create_event(admin, org, title="Over")
    long_over = create_event(admin, org, title="Long over")
    Event.objects.filter(slug=over["slug"]).update(starts_at=timezone.now() - timedelta(days=2), ends_at=timezone.now() - timedelta(days=1))
    Event.objects.filter(slug=long_over["slug"]).update(starts_at=timezone.now() - timedelta(days=9), ends_at=timezone.now() - timedelta(days=8))
    Event.objects.filter(slug=earlier["slug"]).update(starts_at=timezone.now() + timedelta(days=1))
    assert slugs(anonymous.get("/api/events/?when=upcoming")) == [earlier["slug"], later["slug"]]
    # Most recent first.
    assert slugs(anonymous.get("/api/events/?when=past")) == [over["slug"], long_over["slug"]]


def test_platform_admins_see_and_manage_every_event(admin, org, other_org):
    draft = create_event(admin, org, publish=False)
    elsewhere = create_event(sign_in("uma", admin_of=[other_org]), other_org)
    root = sign_in("root", platform_admin=True)
    listed = root.get("/api/events/?scope=managed").json()["results"]
    assert {e["slug"] for e in listed} == {draft["slug"], elsewhere["slug"]}
    assert all(e["can_manage"] for e in listed)
    assert slugs(sign_in("dan").get("/api/events/")) == [elsewhere["slug"]]


def test_event_details_are_checked(admin, org, other_org):
    response = admin.post("/api/events/", event_data(org, organization_id="org-missing"), format="json")
    assert response.status_code == 400 and response.json() == {"organization_id": ["Unknown organisation."]}

    response = admin.post(
        "/api/events/", event_data(org, registration_deadline=in_days(8)), format="json"
    )
    assert response.status_code == 400
    assert response.json() == {"registration_deadline": ["Registration must close before the event ends."]}

    event = create_event(admin, org)
    url = f"/api/events/{event['slug']}/"
    assert admin.patch(url, {"organization_id": org.id, "title": "Same place"}, format="json").status_code == 200
    root = sign_in("root", platform_admin=True)
    moved = root.patch(url, {"organization_id": other_org.id}, format="json")
    assert moved.status_code == 400
    assert moved.json() == {"organization_id": ["An event cannot move to another organisation."]}
    assert Event.objects.get(slug=event["slug"]).organization_id == org.id
    assert str(Event.objects.get(slug=event["slug"])) == "Same place"


def test_cancelling_a_registration_you_do_not_have(admin, bob, org):
    event = create_event(admin, org)
    url = f"/api/events/{event['slug']}/register/"
    assert bob.delete(url).json() == ["You are not registered for this event."]
    bob.post(url)
    bob.delete(url)
    assert bob.delete(url).status_code == 400


def test_leaving_the_waiting_list_promotes_nobody(admin, bob, carol, org):
    event = create_event(admin, org, capacity=1)
    url = f"/api/events/{event['slug']}/register/"
    bob.post(url)
    carol.post(url)
    dan = sign_in("dan")
    dan.post(url)
    assert carol.delete(url).status_code == 200
    statuses = dict(Registration.objects.values_list("profile__full_name", "status"))
    assert statuses == {"Bob": "registered", "Carol": "cancelled", "Dan": "waitlisted"}


def test_no_promotion_once_registration_has_closed(admin, bob, carol, org):
    event = create_event(admin, org, capacity=1)
    url = f"/api/events/{event['slug']}/register/"
    bob.post(url)
    carol.post(url)
    Event.objects.filter(slug=event["slug"]).update(registration_deadline=timezone.now() - timedelta(minutes=1))
    bob.delete(url)
    assert Registration.objects.get(profile=carol.profile).status == Registration.Status.WAITLISTED


def test_organisers_list_registrations(admin, bob, carol, org):
    event = create_event(admin, org)
    bob.post(f"/api/events/{event['slug']}/register/")
    url = f"/api/events/{event['slug']}/registrations/"
    listed = admin.get(url).json()
    assert [(r["email"], r["status"], r["person"]["name"]) for r in listed] == [("bob@example.com", "registered", "Bob")]
    assert carol.get(url).status_code == 403
    registration = Registration.objects.get()
    assert str(registration) == "Bob at Intro to APIs"


def test_check_in_needs_a_ticket_and_a_live_event(admin, bob, org):
    event = create_event(admin, org)
    url = f"/api/events/{event['slug']}/"
    ticket = bob.post(f"{url}register/").json()["my_registration"]["ticket_code"]
    empty = admin.post(f"{url}check-in/", {}, format="json")
    assert empty.status_code == 400 and empty.json() == {"non_field_errors": ["Send a ticket code or a registration."]}

    Event.objects.filter(slug=event["slug"]).update(status=Event.Status.CANCELLED)
    closed = admin.post(f"{url}check-in/", {"ticket_code": ticket}, format="json")
    assert closed.status_code == 400 and closed.json() == ["Check-in is only open for published events."]
    assert Registration.objects.get().checked_in_at is None


def test_a_check_in_can_be_undone(admin, bob, org):
    event = create_event(admin, org)
    url = f"/api/events/{event['slug']}/"
    bob.post(f"{url}register/")
    registration = Registration.objects.get()
    admin.post(f"{url}check-in/", {"registration": registration.id}, format="json")
    assert Registration.objects.get().checked_in_at is not None

    undone = admin.delete(f"{url}check-in/?registration={registration.id}")
    assert undone.status_code == 200 and undone.json()["checked_in_at"] is None
    registration.refresh_from_db()
    assert registration.checked_in_at is None and registration.checked_in_by is None
    assert admin.delete(f"{url}check-in/?registration=999999").status_code == 404
    assert bob.delete(f"{url}check-in/?registration={registration.id}").status_code == 403


def test_certificates_are_not_verified_before_they_are_earned(admin, bob, anonymous, org):
    event = create_event(admin, org)
    bob.post(f"/api/events/{event['slug']}/register/")
    code = Registration.objects.get().certificate_code
    assert anonymous.get(f"/api/certificates/{code}/").status_code == 404


def test_slugs_never_repeat(admin, org, monkeypatch):
    from apps import slugs as slug_module

    codes = iter("aaaaaa" "aaaaaa" "bbbbbb")
    monkeypatch.setattr(slug_module.secrets, "choice", lambda alphabet: next(codes))
    first = create_event(admin, org, title="Same", publish=False)
    second = create_event(admin, org, title="Same", publish=False)
    assert (first["slug"], second["slug"]) == ("same-aaaaaa", "same-bbbbbb")
