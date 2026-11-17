#!/usr/bin/env bash
# Sign-up and branding settings for the local realm. Safe to run again.
#
# keycloak-dev-setup.sh runs this at the end. On a realm created before this
# script existed, run it on its own, from the project root:
#   docker compose exec -T keycloak bash /scripts/keycloak-realm-settings.sh
set -euo pipefail

KEYCLOAK_HOME="${KEYCLOAK_HOME:-/opt/keycloak}"
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8080}"
REALM="${REALM:-amilliontechies}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"

CONFIG="$(mktemp)"
trap 'rm -f "$CONFIG"' EXIT
kc() { local cmd=$1; shift; "$KEYCLOAK_HOME/bin/kcadm.sh" "$cmd" "$@" --config "$CONFIG"; }

kc config credentials --server "$KEYCLOAK_URL" --realm master \
  --user "${KC_ADMIN_USER:-admin}" --password "${KC_ADMIN_PASSWORD:-admin}"

# Branded login pages (keycloak/themes/amt) and self-service sign-up.
#
# No mail server is set up yet, so everything that sends email stays off:
# email verification and "Forgot password?". New members set their password on
# the sign-up form. Once SMTP is configured, turn on verifyEmail and
# resetPasswordAllowed and fill in smtpServer.
kc update "realms/$REALM" \
  -s 'displayName=A Million Techies' \
  -s loginTheme=amt \
  -s registrationAllowed=true \
  -s rememberMe=true \
  -s verifyEmail=false \
  -s resetPasswordAllowed=false \
  -s 'smtpServer={}' \
  -s loginWithEmailAllowed=true \
  -s duplicateEmailsAllowed=false \
  -s bruteForceProtected=true \
  -s 'passwordPolicy=length(8) and notUsername and notEmail'

# "Back to Community" on the login pages links to the client's base URL.
frontend="$(kc get clients -r "$REALM" -q clientId=amt-frontend --fields id --format csv --noquotes)"
kc update "clients/$frontend" -r "$REALM" -s "rootUrl=$FRONTEND_URL" -s "baseUrl=$FRONTEND_URL/"

echo "Realm '$REALM': sign-up on, login theme 'amt', email features off."
