#!/usr/bin/env bash
# Connect the realm to a mail server, so "Forgot password?" emails arrive.
# Safe to run again with new values.
#
# From the project root, with your provider's SMTP details:
#   docker compose exec -T \
#     -e SMTP_HOST=smtp.example.com -e SMTP_PORT=587 \
#     -e SMTP_USER=... -e SMTP_PASSWORD=... \
#     -e SMTP_FROM=no-reply@amilliontechies.com \
#     keycloak bash /scripts/keycloak-email.sh
#
# Port 587 uses STARTTLS (the default here); for port 465 set SMTP_SSL=true and
# SMTP_STARTTLS=false. Leave SMTP_USER empty for a server without sign-in.
# The password stays in Keycloak's database; nothing is written to the repository.
# Once email works, you can also turn on email verification for new members:
#   add -e VERIFY_EMAIL=true
set -euo pipefail

: "${SMTP_HOST:?Set SMTP_HOST to your mail server, e.g. smtp.gmail.com}"
: "${SMTP_FROM:?Set SMTP_FROM to the address emails come from}"
SMTP_PORT="${SMTP_PORT:-587}"
SMTP_USER="${SMTP_USER:-}"
SMTP_PASSWORD="${SMTP_PASSWORD:-}"
SMTP_STARTTLS="${SMTP_STARTTLS:-true}"
SMTP_SSL="${SMTP_SSL:-false}"
SMTP_FROM_NAME="${SMTP_FROM_NAME:-A Million Techies}"
VERIFY_EMAIL="${VERIFY_EMAIL:-false}"

KEYCLOAK_HOME="${KEYCLOAK_HOME:-/opt/keycloak}"
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8080}"
REALM="${REALM:-amilliontechies}"

CONFIG="$(mktemp)"
trap 'rm -f "$CONFIG"' EXIT
kc() { local cmd=$1; shift; "$KEYCLOAK_HOME/bin/kcadm.sh" "$cmd" "$@" --config "$CONFIG"; }

kc config credentials --server "$KEYCLOAK_URL" --realm master \
  --user "${KC_ADMIN_USER:-admin}" --password "${KC_ADMIN_PASSWORD:-admin}"

auth=false
[ -n "$SMTP_USER" ] && auth=true

kc update "realms/$REALM" \
  -s "smtpServer.host=$SMTP_HOST" \
  -s "smtpServer.port=$SMTP_PORT" \
  -s "smtpServer.from=$SMTP_FROM" \
  -s "smtpServer.fromDisplayName=$SMTP_FROM_NAME" \
  -s "smtpServer.starttls=$SMTP_STARTTLS" \
  -s "smtpServer.ssl=$SMTP_SSL" \
  -s "smtpServer.auth=$auth" \
  -s "smtpServer.user=$SMTP_USER" \
  -s "smtpServer.password=$SMTP_PASSWORD" \
  -s resetPasswordAllowed=true \
  -s "verifyEmail=$VERIFY_EMAIL"

echo "Realm '$REALM' sends email through $SMTP_HOST:$SMTP_PORT as $SMTP_FROM."
