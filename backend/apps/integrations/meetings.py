"""Web conferencing: recognise which service a meeting link belongs to.

Organisers paste whatever link their tool gives them. Knowing the service lets the event
page say "Join on Microsoft Teams" and lets emails and calendar invites name it.
"""

from urllib.parse import urlparse

# (id, name, hosts). A host matches itself and its subdomains (us02web.zoom.us).
PROVIDERS = [
    ("google_meet", "Google Meet", ("meet.google.com",)),
    ("teams", "Microsoft Teams", ("teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft")),
    ("zoom", "Zoom", ("zoom.us", "zoom.com", "zoomgov.com")),
    ("webex", "Webex", ("webex.com",)),
    ("jitsi", "Jitsi Meet", ("meet.jit.si", "8x8.vc")),
    ("whereby", "Whereby", ("whereby.com",)),
    ("goto", "GoTo Meeting", ("meet.goto.com", "gotomeeting.com", "global.gotomeeting.com")),
    ("skype", "Skype", ("join.skype.com",)),
    ("discord", "Discord", ("discord.gg", "discord.com")),
    ("slack", "Slack huddle", ("app.slack.com",)),
    ("youtube", "YouTube Live", ("youtube.com", "youtu.be")),
    ("streamyard", "StreamYard", ("streamyard.com",)),
    ("bigbluebutton", "BigBlueButton", ("bigbluebutton.org",)),
]


def detect(url: str) -> dict | None:
    """{"id": "teams", "name": "Microsoft Teams"} for a known service, else None."""
    if not url:
        return None
    host = (urlparse(url).hostname or "").lower()
    for provider_id, name, hosts in PROVIDERS:
        if any(host == h or host.endswith(f".{h}") for h in hosts):
            return {"id": provider_id, "name": name}
    return None
