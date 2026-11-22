# A Million Techies Community

The Community platform (`community.amilliontechies.com`): events, hackathons and the
people who run and join them. This first slice covers the foundation (sign-in, profiles,
organisations, scoped roles), Events and Hackathons.

| Part | Stack | Where |
| --- | --- | --- |
| API | Django 5.2, Django REST Framework, PostgreSQL 16 | `backend/` |
| Web app | React 19, Vite, TypeScript, Tailwind | `frontend/` |
| Identity | Keycloak 26.8 at `auth.amilliontechies.com`, through [`amt-auth`](https://pypi.org/project/amt-auth/) | [amt_auth](https://github.com/MillionTechies/amt_auth) |

## Run it locally

You need Docker, Python 3.12 and Node 22.

```bash
# 1. PostgreSQL (port 5433) and Mailpit (inbox on port 8025)
docker compose up -d

# 2. API on http://localhost:8000
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env                     # then fill in AMT_CLIENT_SECRET
.venv/bin/python manage.py migrate
.venv/bin/python manage.py amt_sync      # copy organisations from Keycloak
.venv/bin/python manage.py runserver
# In a second terminal: sends reminders, retries failed emails, syncs organisations
.venv/bin/python manage.py run_worker

# 3. Web app on http://localhost:5173
cd frontend
npm install
cp .env.example .env
npm run dev
```

There is no local Keycloak. Sign-in goes to the shared identity server,
`https://auth.amilliontechies.com`, so you sign in locally with your real A Million
Techies account, and you see the real organisations. The identity server accepts sign-ins
from `http://localhost:5173` (that is why Vite refuses any other port). Ask the platform
admin for:

- `AMT_CLIENT_SECRET`, the `community-backend` secret, for `backend/.env`. Never commit it
  or paste it into chat.
- The `admin` role or an organisation's `/admins` group, if you need the console.

Your local database is your own: events, registrations and profiles you create locally
stay on your machine. Users, passwords and organisations are the real ones, so changes to
organisations (creating one, inviting a member) happen on the identity server for real.

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

Anyone can create an account from the **Join** button. Email verification is on: the
member gives their name and email, follows the link in the email, and sets their password
then. "Forgot password?" emails a reset link.

Sign-in and sign-up pages, the `amt` login theme, sign-in options (password, passkeys;
Google is not set up yet) and Keycloak's email settings all belong to the identity server.
They live in [amt_auth](https://github.com/MillionTechies/amt_auth) under
`deploy/keycloak/`; change them there. Its README also covers adding a URL the web app
may sign in from, such as a staging site.

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
cd backend && .venv/bin/pytest --cov     # needs the database container running
cd frontend && npm run test:coverage     # Vitest; `npm test` watches while you work
cd frontend && npm run lint && npm run build
```

Both suites must cover 100% of the code (lines and branches). CI fails below that, so
every change comes with its tests. Migrations, `config/asgi.py`, `config/wsgi.py` and
`src/main.tsx` are left out of the count.

## Branches and releases

- `develop` is where work comes together. Branch off it (`feat/…`, `fix/…`, `chore/…`)
  and open the pull request against it.
- `main` is what is released. Only `release/…` branches merge into it; CI refuses any
  other pull request into `main`. After a release is merged, merge `main` back into
  `develop`.
- A branch is deleted once its pull request is merged. `main`, `develop` and `release/…`
  branches are kept.
- CI (`.github/workflows/ci.yml`) runs the branch rule, the backend tests and the
  frontend lint, build and tests on every pull request into `develop` or `main`.

The backend tests sign members in with made-up token claims, so they do not need Keycloak.

## Production

Community runs at https://community.amilliontechies.com with its API at
https://api.community.amilliontechies.com, on the same server and behind the same Caddy
as the identity server. Merging a release into `main` deploys it automatically.
[`deploy/README.md`](deploy/README.md) covers the first deploy, automatic deploys,
backups and restores.

## How identity and access work

Keycloak owns sign-in, users, organisations and organisation groups. The web app signs in
with the authorization code flow (PKCE) and sends the access token to the API. `amt-auth`
validates it and reads the member's organisations and groups from it.

- **Platform admin**: Keycloak realm role `admin`. Oversees the platform: the Platform
  area, organisation applications and platform settings. It gives no rights inside an
  organisation; to run an organisation's events, be its admin or hold a role there.
- **Organisation admin**: member of the organisation's `/admins` group in Keycloak.
  Manages everything in that organisation.
- **Event organiser, hackathon manager**: granted by an organisation's admin inside
  Community (Organisation page). Stored in `accounts.RoleAssignment`, scoped to one organisation.
- **Judge**: added to one hackathon by its managers.
- **Participant**: any signed-in member.

Community keeps a `Profile` row per member (keyed on the Keycloak user ID), created on
their first API call; that first call also queues a welcome email. Organisations are read
from amt-auth's mirror tables, kept in step with Keycloak three ways: when a member's
token names an organisation the mirror has not seen, it is synced on that request;
`run_worker` runs a full sync every 15 minutes (`--sync-interval`); and platform admins
can press **Sync** under Organizations. Only one full sync runs at a time.

### Organisations joining

Universities, companies, tech communities, clubs and non-profits join from
**Bring your organisation** (`/organizations/join`, linked from the home page, the footer
and the organiser console). A signed-in member describes the organisation and applies;
they get an email confirming it. Platform admins review applications under
**Platform → Applications** (pending ones also show under "Needs attention").

- **Approve**: pick the alias (suggested from the name; it cannot change later). Community
  then creates the organisation in Keycloak with its `admins`, `clubs` and `mentorships`
  groups, makes the applicant a member and an admin, syncs it into the mirror and emails
  them. Every step can be repeated, so if Keycloak fails part-way, approving again carries
  on where it stopped. It uses `community-backend`'s service account, which amt_auth's
  Keycloak setup already gives `manage-organizations` and `manage-users`.
- **Decline**: give a reason; it is emailed to the applicant, who may apply again.

`apps/accounts/onboarding.py` holds the Keycloak steps.

In production, Keycloak runs at `https://auth.amilliontechies.com`; see `deploy/keycloak/`
in amt_auth. Community's backend uses client `community-backend` and the web app
`community-frontend`.

Every event and hackathon belongs to one organisation. Drafts are visible only to the
people who manage that organisation, and no one else can edit them, not even platform admins; `apps/accounts/access.py` holds the rules.

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
```
