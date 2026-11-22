#!/usr/bin/env bash
# Bring the server up to date with GitHub. Run it on the server after a release:
#   /var/www/projects/amt-community/deploy/deploy.sh
#
# 1. git pull (fast-forward only), then restarts itself so the new copy of this
#    script is the one that runs
# 2. backs up the database and uploads (backup.sh), if Community is already running
# 3. builds the API and web images from this checkout
# 4. starts PostgreSQL and applies migrations
# 5. docker compose up -d, and waits until the API and web app are healthy
# 6. checks the public URLs
#
# Options: --no-pull, --no-backup.
#
# GitHub Actions runs this after every merge to main (.github/workflows/deploy.yml),
# over an SSH key that can run nothing else.
set -euo pipefail

cd "$(dirname "$0")"

PULL=1 BACKUP=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --no-backup) BACKUP=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }
# The last NAME=value line in .env, without the quotes around the value if it has them.
env_value() {
  local value
  value="$(grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  echo "$value"
}

[ -f .env ] || { echo ".env is missing: cp .env.example .env and fill it in." >&2; exit 1; }

# --- 1. Pull -----------------------------------------------------------------------
# Pulling can change this very file while bash is reading it, so pull first and
# then start again from the fresh copy.
if [ "$PULL" = 1 ] && [ -z "${AMT_DEPLOY_PULLED:-}" ]; then
  step "Pulling $(git rev-parse --abbrev-ref HEAD) from GitHub"
  git pull --ff-only
  AMT_DEPLOY_PULLED=1 exec bash "$PWD/$(basename "$0")" "$@"
fi
echo "Deploying $(git log -1 --format='%h %s')"

COMMUNITY_URL="$(env_value COMMUNITY_URL)"
API_URL="$(env_value API_URL)"

# --- 2. Backup ---------------------------------------------------------------------
if [ "$BACKUP" = 1 ] && [ -n "$(docker compose ps -q amt-community-db 2>/dev/null)" ]; then
  step "Backing up the database and uploads"
  ./backup.sh
fi

# --- 3. Build ----------------------------------------------------------------------
step "Building the API and the web app"
docker compose build

# --- 4. Migrate --------------------------------------------------------------------
step "Applying migrations"
docker compose up -d --wait amt-community-db
docker compose run --rm --no-deps amt-community-api python manage.py migrate --noinput

# --- 5. Start ----------------------------------------------------------------------
step "Starting Community"
docker compose up -d --remove-orphans

printf 'Waiting for the API and the web app to be healthy'
healthy=0
for _ in $(seq 1 40); do
  api="$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q amt-community-api)" 2>/dev/null || true)"
  web="$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q amt-community-web)" 2>/dev/null || true)"
  [ "$api $web" = "healthy healthy" ] && { healthy=1; break; }
  printf '.'
  sleep 3
done
echo
if [ "$healthy" = 0 ]; then
  echo "Not healthy after 2 minutes (api: $api, web: $web). Logs: docker compose logs --tail 100" >&2
  exit 1
fi
echo "The API and the web app are healthy."

# --- 6. Check ----------------------------------------------------------------------
step "Checking $COMMUNITY_URL and $API_URL"
site="$(curl -s -o /dev/null -w '%{http_code}' "$COMMUNITY_URL/")"
page="$(curl -s -o /dev/null -w '%{http_code}' "$COMMUNITY_URL/events")"
api="$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/api/stats/")"
echo "web app:     $site"
echo "app routes:  $page (served by the app, expected 200)"
echo "API:         $api"
if [ "$site $page $api" != "200 200 200" ]; then
  echo "Check failed." >&2
  exit 1
fi

echo
echo "Done: $(git log -1 --format='%h %s')"
