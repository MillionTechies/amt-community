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
# 1. PostgreSQL (port 5433) and Keycloak (port 8080)
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
API docs are at http://localhost:8000/api/docs/.

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
