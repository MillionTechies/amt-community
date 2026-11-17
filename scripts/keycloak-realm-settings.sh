#!/usr/bin/env bash
# Sign-up, branding and email settings for the local realm. Safe to run again.
#
# keycloak-dev-setup.sh runs this at the end. On a realm created before this
# script existed, run it on its own, from the project root:
#   docker compose exec -T keycloak bash /scripts/keycloak-realm-settings.sh
# Dev-only values throughout (Mailpit as the mail server).
set -euo pipefail

KEYCLOAK_HOME="${KEYCLOAK_HOME:-/opt/keycloak}"
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8080}"
REALM="${REALM:-amilliontechies}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"
SMTP_HOST="${SMTP_HOST:-mailpit}"
SMTP_PORT="${SMTP_PORT:-1025}"

CONFIG="$(mktemp)"
trap 'rm -f "$CONFIG"' EXIT
kc() { local cmd=$1; shift; "$KEYCLOAK_HOME/bin/kcadm.sh" "$cmd" "$@" --config "$CONFIG"; }

kc config credentials --server "$KEYCLOAK_URL" --realm master \
  --user "${KC_ADMIN_USER:-admin}" --password "${KC_ADMIN_PASSWORD:-admin}"

# Branded login pages (keycloak/themes/amt) and self-service sign-up.
# New members verify their email before their first sign-in; Mailpit catches
# those emails locally at http://localhost:8025.
kc update "realms/$REALM" \
  -s 'displayName=A Million Techies' \
  -s loginTheme=amt \
  -s registrationAllowed=true \
  -s resetPasswordAllowed=true \
  -s rememberMe=true \
  -s verifyEmail=true \
  -s loginWithEmailAllowed=true \
  -s duplicateEmailsAllowed=false \
  -s bruteForceProtected=true \
  -s 'passwordPolicy=length(8) and notUsername and notEmail' \
  -s "smtpServer.host=$SMTP_HOST" \
  -s "smtpServer.port=$SMTP_PORT" \
  -s 'smtpServer.from=no-reply@amilliontechies.com' \
  -s 'smtpServer.fromDisplayName=A Million Techies'

# "Back to Community" on the login pages links to the client's base URL.
frontend="$(kc get clients -r "$REALM" -q clientId=amt-frontend --fields id --format csv --noquotes)"
kc update "clients/$frontend" -r "$REALM" -s "rootUrl=$FRONTEND_URL" -s "baseUrl=$FRONTEND_URL/"

echo "Realm '$REALM': sign-up on, login theme 'amt', email through $SMTP_HOST:$SMTP_PORT."
