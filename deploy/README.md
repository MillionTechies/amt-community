# Production: community.amilliontechies.com

[![Deploy Community](https://github.com/MillionTechies/amt-community/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/MillionTechies/amt-community/actions/workflows/deploy.yml)

Community runs on the same server as the identity server (`auth.amilliontechies.com`,
see [amt_auth](https://github.com/MillionTechies/amt_auth) `deploy/keycloak/`), behind
the same Caddy, set up the same way.

| File | What it is |
| --- | --- |
| `docker-compose.yml` | API (gunicorn), worker, web app, PostgreSQL 16. Nothing published on the host |
| `api.Dockerfile` | The Django API; the worker runs the same image |
| `web.Dockerfile`, `web.Caddyfile` | The Vite build, served by a small Caddy that also serves uploaded images |
| `Caddyfile.snippet` | The two site blocks for the server's Caddy |
| `.env.example` | Settings and secrets; copy to `.env` on the server |
| `deploy.sh` | Pull, back up, build, migrate, restart, check |
| `backup.sh` | Nightly database dump and uploads archive, copied off the server |

## How it fits together

```
browser ─► community.amilliontechies.com ─────► Caddy ─► amt-community-web   (the app)
        └► api.community.amilliontechies.com ─► Caddy ─┬► amt-community-web  (/media/: uploads)
                                                       └► amt-community-api  (everything else)
amt-community-worker: emails, reminders, organisation sync    amt-community-db: internal only
```

- Caddy reaches the services over the shared Docker network `PROXY_NETWORK`. They are
  named `amt-community-…` because that network is shared with other projects, and a
  plain `api` or `db` would clash in Docker's DNS.
- Sign-in goes to `auth.amilliontechies.com`, which only accepts
  `https://community.amilliontechies.com` (and `http://localhost:5173` for developers).
- The API writes uploads to the `media` volume; the web container serves it read-only,
  so the shared Caddy never needs access to Community's files.

## First deploy

1. **DNS**: in Cloudflare, add A records `community` and `api.community` pointing at the
   server's IP, set to DNS only (grey cloud), so Caddy can get the certificates.
2. **Checkout** (as the user that owns `/var/www/projects`, e.g. `dev`):
   ```bash
   cd /var/www/projects
   git clone git@github.com:MillionTechies/amt-community.git
   cd amt-community && git switch main
   cp deploy/.env.example deploy/.env && chmod 600 deploy/.env
   ```
   Fill in `deploy/.env`: `DB_PASSWORD` and `DJANGO_SECRET_KEY` (`openssl rand -hex 32`
   each), `INTEGRATIONS_ENCRYPTION_KEY` (`openssl rand -base64 32 | tr '+/' '-_'`, the
   Fernet format it needs), `AMT_CLIENT_SECRET` (admin console,
   realm A Million Techies, Clients > community-backend > Credentials) and the SMTP login.
   `PROXY_NETWORK` is the same as in the identity server's `.env`.
3. **Start**: `deploy/deploy.sh --no-pull`. It builds, migrates and starts everything,
   and its last check fails until step 4 is done; that is expected the first time.
4. **Caddy**: add `deploy/Caddyfile.snippet` to the server's Caddyfile and reload Caddy.
   Then run `deploy/deploy.sh --no-pull` again: every check should pass.
5. **Backups**: add the cron line from the top of `backup.sh`, and set `BACKUP_REMOTE`
   once an rclone remote exists.
6. **First admin**: in the identity server's admin console, give your account the realm
   role `admin`, then sign in at https://community.amilliontechies.com.

## Automatic deploys

Every merge into `main` (a release) runs `.github/workflows/deploy.yml`, which runs
`deploy.sh` on the server and then checks the site, the API and sign-in. GitHub signs in
with its own SSH key, which the server only lets run `deploy.sh`.

1. On the server, as the checkout's owner:
   ```bash
   ssh-keygen -t ed25519 -N '' -C github-actions-community -f ~/.ssh/github-community
   echo "command=\"/var/www/projects/amt-community/deploy/deploy.sh\",restrict $(cat ~/.ssh/github-community.pub)" >> ~/.ssh/authorized_keys
   cat ~/.ssh/github-community      # copy into the DEPLOY_SSH_KEY secret, then:
   rm ~/.ssh/github-community ~/.ssh/github-community.pub
   ```
2. From your machine: `ssh-keyscan -t ed25519 <server ip>`; the output goes into the
   `DEPLOY_KNOWN_HOSTS` secret.
3. In GitHub (amt-community), **Settings → Secrets and variables → Actions**: secrets
   `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS`; variables `DEPLOY_HOST` (server IP) and
   `DEPLOY_USER` (e.g. `dev`). The same values as amt_auth's, except the key.

`git pull` on the server must work without a prompt (the checkout's GitHub key). To stop
automatic deploys, remove the `command=...` line from `~/.ssh/authorized_keys`.

## Release

```bash
git switch develop && git pull
git switch -c release/0.1.0 && git push -u origin release/0.1.0
```
Open the pull request from `release/0.1.0` into `main`. Merging it deploys. Then merge
`main` back into `develop`.

## Day to day

```bash
cd /var/www/projects/amt-community/deploy
docker compose ps                                   # what is running
docker compose logs -f --tail 100 amt-community-api # or -worker, -web
docker compose exec amt-community-api python manage.py amt_sync   # organisations now
./deploy.sh --no-pull                               # rebuild and restart this checkout
```

## Restore a backup

```bash
cd /var/www/projects/amt-community/deploy
docker compose stop amt-community-api amt-community-worker
docker compose exec -T amt-community-db pg_restore -U community -d community --clean --if-exists < backups/community-<stamp>.dump
docker compose run --rm --no-deps -T amt-community-api sh -c 'rm -rf media/* && tar -C /app -xzf -' < backups/media-<stamp>.tar.gz
docker compose up -d
```
