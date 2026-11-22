#!/usr/bin/env bash
# Nightly backup of Community: a pg_dump of the database and an archive of the uploaded
# images, kept here for 14 days and copied off the server with rclone (BACKUP_REMOTE in
# .env, e.g. r2:amt-community-backups).
#
# Run from cron, next to docker-compose.yml:
#   30 2 * * * /var/www/projects/amt-community/deploy/backup.sh >> /var/www/projects/amt-community/deploy/backups/backup.log 2>&1
# Restore: see "Restore a backup" in README.md.
set -euo pipefail

cd "$(dirname "$0")"
BACKUP_REMOTE="$(grep -E '^BACKUP_REMOTE=' .env 2>/dev/null | cut -d= -f2- || true)"
KEEP_DAYS=14

mkdir -p backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
db="backups/community-$stamp.dump"
media="backups/media-$stamp.tar.gz"

docker compose exec -T amt-community-db pg_dump -U community -d community --format=custom > "$db.partial"
mv "$db.partial" "$db"
docker compose exec -T amt-community-api tar -C /app -czf - media > "$media.partial"
mv "$media.partial" "$media"
echo "$(date -u +%FT%TZ) wrote $db ($(du -h "$db" | cut -f1)) and $media ($(du -h "$media" | cut -f1))"

find backups -name 'community-*.dump' -mtime +"$KEEP_DAYS" -delete
find backups -name 'media-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

if [ -n "$BACKUP_REMOTE" ]; then
  rclone copy "$db" "$BACKUP_REMOTE"
  rclone copy "$media" "$BACKUP_REMOTE"
  rclone delete --min-age "${KEEP_DAYS}d" "$BACKUP_REMOTE"
  echo "$(date -u +%FT%TZ) copied to $BACKUP_REMOTE"
else
  echo "$(date -u +%FT%TZ) WARNING: BACKUP_REMOTE is not set; the backup exists only on this server" >&2
fi
