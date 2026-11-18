# A Million Techies Community

The Community platform (`community.amilliontechies.com`): events, hackathons and the
people who run and join them. This first slice covers the foundation (sign-in, profiles,
organisations, scoped roles), Events and Hackathons.

| Part | Stack | Where |
| --- | --- | --- |
| API | Django 5.2, Django REST Framework, PostgreSQL 16 | `backend/` |
| Web app | React 19, Vite, TypeScript, Tailwind | `frontend/` |
| Identity | Keycloak 26.8 through [`amt-auth`](https://pypi.org/project/amt-auth/) | `docker-compose.yml` |

## Run it locally

You need Docker, Python 3.12 and Node 22.

```bash
# 1. PostgreSQL (port 5433), Keycloak (port 8080) and Mailpit (inbox on port 8025)
docker compose up -d

# 2. Create the dev realm, clients and sample users. Once, after Keycloak is up.
docker compose exec -T keycloak bash /scripts/keycloak-dev-setup.sh

# 3. API on http://localhost:8000
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env
.venv/bin/python manage.py migrate
.venv/bin/python manage.py amt_sync      # copy organisations from Keycloak
.venv/bin/python manage.py runserver
# In a second terminal: sends reminders and retries failed emails
.venv/bin/python manage.py run_worker

# 4. Web app on http://localhost:5173
cd frontend
npm install
cp .env.example .env
npm run dev
```

Sample users (the password is the username):

| User | Who they are |
| --- | --- |
| `alice` | Platform admin, and admin of the JKUAT organisation |
| `bob` | A member with no organisation |
| `carol` | A member with no organisation |

Keycloak's own admin console is at http://localhost:8080 (`admin` / `admin`).

### Configuration

**Console → Configuration** keeps the settings admins change in one place: the Google,
Microsoft and Zoom apps, email (SMTP server, login, sender, reply-to, with a "send test
email" button) and image storage (disk, or an S3-compatible bucket). Platform admins edit
the platform's values; an organisation's admins can override its apps, sender name and
reply-to. Secrets are stored encrypted and never shown again. Anything left empty falls
back to the platform's value, then to `backend/.env`.

### Email

Community emails people when they register, come off the waiting list, or get an
announcement, when an event's time, place or link changes, when it is cancelled, and a
day and an hour before it starts. Invites (`.ics`) are attached, so the event lands in
Google, Outlook or Apple Calendar and updates there when it changes.

Locally every email goes to Mailpit: open http://localhost:8025 to read them. Nothing
leaves your machine. Emails are queued in the `OutboundEmail` table and sent right after
the request; `run_worker` sends reminders and retries anything that failed, so keep it
running (in production, as its own process or container). To send for real, point the
`EMAIL_*` settings in `backend/.env` at any SMTP service (Google Workspace, Microsoft 365,
SendGrid, Mailgun, Amazon SES).

### Sign-up and the login theme

Anyone can create an account from the **Join** button and sets a password on the sign-up
form.

"Forgot password?" is on, but it emails a reset link, so **reset emails only arrive once a
mail server is connected**. Until then Keycloak says an email is on its way and none comes.
Connect one with your provider's SMTP details (the password stays in Keycloak):

```bash
docker compose exec -T -e SMTP_HOST=smtp.example.com -e SMTP_PORT=587 \
  -e SMTP_USER=... -e SMTP_PASSWORD=... -e SMTP_FROM=no-reply@amilliontechies.com \
  keycloak bash /scripts/keycloak-email.sh
```

Add `-e VERIFY_EMAIL=true` to also make new members confirm their email address.

The sign-in and sign-up pages use the `amt` login theme in `keycloak/themes/amt/`, which
extends Keycloak's own `keycloak.v2` theme with the Community layout, colours and wording.
`start-dev` does not cache themes, so edits show on the next page load.

A realm created before sign-up was added needs its settings once:

```bash
docker compose up -d   # mounts the login theme
docker compose exec -T keycloak bash /scripts/keycloak-realm-settings.sh
```

### Continue with Google

Optional. In Google Cloud Console, open APIs & Services > Credentials, create an
**OAuth client ID** of type **Web application**, and add this authorised redirect URI:

```
http://localhost:8080/realms/amilliontechies/broker/google/endpoint
```

Then give Keycloak the client's ID and secret (rerun with new values to change them):

```bash
docker compose exec -T -e GOOGLE_CLIENT_ID=... -e GOOGLE_CLIENT_SECRET=... \
  keycloak bash /scripts/keycloak-google.sh
```

"Continue with Google" then shows on the sign-in page and at the top of the sign-up page.
Google has already verified the address, so members who join this way skip the
verification email. If someone signs in with Google using the email of an existing account,
Keycloak asks them to confirm it is theirs before linking the two.
API docs are at http://localhost:8000/api/docs/.

### Google, Microsoft and Zoom (connected accounts)

Organisers can connect their own Google, Microsoft or Zoom account under **Console →
Connected accounts**, then, in an event, create a Google Meet, Teams or Zoom meeting with
one click (it becomes the join link) or keep the event in their Google or Outlook calendar.
Those copies follow every change to the event and are removed if it is cancelled. Pasting a
meeting link by hand always works, with or without any of this.

Each service needs an OAuth app, registered once by an admin. The redirect URI is
`<API_URL>/api/integrations/<google|microsoft|zoom>/callback/`, so locally
`http://localhost:8000/api/integrations/google/callback/` (the Configuration page shows it
with a copy button). Enter the keys on **Console → Configuration**: platform admins set
them for everyone, and an organisation's admins can enter its own app (say, the
university's Google Workspace) for its events alone. Values in `backend/.env` are used
when nothing is set there.

- **Google**: in the [Google Cloud console](https://console.cloud.google.com/), create a
  project, enable the **Google Calendar API**, configure the OAuth consent screen with the
  `.../auth/calendar.events` scope, then create an **OAuth client ID** (Web application)
  with the redirect URI. Set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.
  While the app is in "Testing", only the test users you list can connect.
- **Microsoft**: in the [Azure portal](https://portal.azure.com/), go to **Microsoft Entra ID
  → App registrations → New registration**, allow work, school and personal accounts, and
  add the redirect URI as a **Web** platform. Create a client secret, and add the delegated
  Microsoft Graph permissions `User.Read`, `Calendars.ReadWrite`, `offline_access`, `openid`
  and `email`. Set `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET` and, to
  limit it to your organisation, `MICROSOFT_OAUTH_TENANT`. Teams links need an account
  with Microsoft Teams.
- **Zoom**: in the [Zoom App Marketplace](https://marketplace.zoom.us/), build a **General
  app** with user-managed OAuth, add the redirect URI (and to the allow list), and the
  scopes `user:read:user`, `meeting:write:meeting`, `meeting:update:meeting` and
  `meeting:delete:meeting`. Set `ZOOM_OAUTH_CLIENT_ID` and `ZOOM_OAUTH_CLIENT_SECRET`. If
  Zoom refuses an `http://localhost` redirect, use an HTTPS tunnel and set `API_URL` to it.

Tokens are stored encrypted (`INTEGRATIONS_ENCRYPTION_KEY`, or a key derived from
`DJANGO_SECRET_KEY`).

## Tests

```bash
cd backend && .venv/bin/pytest     # needs the database container running
cd frontend && npm run build       # type-check and build
```

The backend tests sign members in with made-up token claims, so they do not need Keycloak.

## How identity and access work

Keycloak owns sign-in, users, organisations and organisation groups. The web app signs in
with the authorization code flow (PKCE) and sends the access token to the API. `amt-auth`
validates it and reads the member's organisations and groups from it.

- **Platform admin**: Keycloak realm role `admin`. Manages every organisation.
- **Organisation admin**: member of the organisation's `/admins` group in Keycloak.
  Manages everything in that organisation.
- **Event organiser, hackathon manager**: granted by an organisation's admin inside
  Community (Organisation page). Stored in `accounts.RoleAssignment`, scoped to one organisation.
- **Judge**: added to one hackathon by its managers.
- **Participant**: any signed-in member.

Community keeps a `Profile` row per member (keyed on the Keycloak user ID), created on
their first API call. Organisations are read from amt-auth's mirror tables, which are
filled by `manage.py amt_sync` or by Keycloak admin events posted to `/auth/webhook/`.

Every event and hackathon belongs to one organisation. Drafts are visible only to the
people who manage that organisation; `apps/accounts/access.py` holds the rules.

## What is in this slice

**Events**: create, publish, complete and cancel; types and delivery modes; capacity with
a waiting list that promotes automatically; registration deadline; QR ticket per
registration and camera check-in for organisers; announcements; resources; feedback from
attendees; participation certificates with a public verification link; statistics and
CSV export.

**Hackathons**: challenges, rules, judging criteria with weights; teams with invite
links, size limits and leader controls (a solo participant is a team of one); project
submission with repository and demo links until the deadline; judges added by email;
scoring per criterion; leaderboard; published results and project showcase.

Not built yet: mentorship, campus chapters, projects, opportunities, community
engagement, and email or push notifications.

## Layout

```
backend/
  config/            settings and URL routing
  apps/accounts/     profiles, scoped roles, access rules, /api/me/
  apps/events/       events, registrations, check-in, feedback, certificates
  apps/hackathons/   hackathons, teams, submissions, judging, leaderboard
  tests/
frontend/src/
  api.ts             fetch helper and API types
  auth.ts            Keycloak (OIDC) settings
  pages/             one file per screen
  components/        shared UI
scripts/keycloak-dev-setup.sh   dev realm setup, adapted from amt_auth
```
