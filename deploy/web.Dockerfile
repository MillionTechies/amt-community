# The Community web app: the Vite build, served by a small Caddy, which also serves
# uploaded images from the API's media volume. Built with the repo root as context.
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
# Vite bakes these into the bundle at build time.
ARG VITE_API_URL
ARG VITE_KEYCLOAK_URL=https://auth.amilliontechies.com
ARG VITE_KEYCLOAK_REALM=amilliontechies
ARG VITE_KEYCLOAK_CLIENT_ID=community-frontend
ENV VITE_API_URL=$VITE_API_URL VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL \
    VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID
RUN test -n "$VITE_API_URL" && npx vite build

FROM caddy:2-alpine
COPY deploy/web.Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv/site
