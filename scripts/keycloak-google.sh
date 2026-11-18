#!/usr/bin/env bash
# Add "Continue with Google" to the realm, or update it. Safe to run again.
#
# Needs an OAuth client from Google Cloud Console (APIs & Services > Credentials >
# Create credentials > OAuth client ID > Web application) with this redirect URI:
#   http://localhost:8080/realms/amilliontechies/broker/google/endpoint
#
# From the project root, with the client's ID and secret:
#   docker compose exec -T -e GOOGLE_CLIENT_ID=... -e GOOGLE_CLIENT_SECRET=... \
#     keycloak bash /scripts/keycloak-google.sh
# The secret stays in Keycloak's database; nothing is written to the repository.
set -euo pipefail

: "${GOOGLE_CLIENT_ID:?Set GOOGLE_CLIENT_ID to the OAuth client ID from Google Cloud Console}"
: "${GOOGLE_CLIENT_SECRET:?Set GOOGLE_CLIENT_SECRET to the OAuth client secret}"

KEYCLOAK_HOME="${KEYCLOAK_HOME:-/opt/keycloak}"
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8080}"
REALM="${REALM:-amilliontechies}"

CONFIG="$(mktemp)"
trap 'rm -f "$CONFIG"' EXIT
kc() { local cmd=$1; shift; "$KEYCLOAK_HOME/bin/kcadm.sh" "$cmd" "$@" --config "$CONFIG"; }

kc config credentials --server "$KEYCLOAK_URL" --realm master \
  --user "${KC_ADMIN_USER:-admin}" --password "${KC_ADMIN_PASSWORD:-admin}"

# trustEmail: Google has already verified the address, so members who join with
# Google skip Keycloak's verification email. syncMode=IMPORT keeps a member's
# own profile edits instead of overwriting them from Google on every sign-in.
settings=(
  -s alias=google -s providerId=google -s 'displayName=Google'
  -s enabled=true -s trustEmail=true -s storeToken=false
  -s 'firstBrokerLoginFlowAlias=first broker login'
  -s "config.clientId=$GOOGLE_CLIENT_ID"
  -s "config.clientSecret=$GOOGLE_CLIENT_SECRET"
  -s 'config.defaultScope=openid profile email'
  -s config.syncMode=IMPORT
  -s config.guiOrder=1
)

if kc get "identity-provider/instances/google" -r "$REALM" >/dev/null 2>&1; then
  kc update "identity-provider/instances/google" -r "$REALM" "${settings[@]}"
  echo "Updated Google sign-in for realm '$REALM'."
else
  kc create identity-provider/instances -r "$REALM" "${settings[@]}"
  echo "Added Google sign-in to realm '$REALM'."
fi
