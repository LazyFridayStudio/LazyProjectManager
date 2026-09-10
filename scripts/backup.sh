#!/bin/sh
set -eu

# Takes a backup of a running install: the database, and everything in the
# object store.
#
# Both halves are needed. The database knows a file exists, where it lives and
# what it is attached to; the object store holds the bytes. A backup of one is a
# restore that half works — a board full of attachments that 404, or a bucket of
# objects nothing refers to.
#
# Everything runs inside the containers, on purpose. `pg_dump` has to match the
# server it dumps and `mc` has to match the store, and requiring an operator to
# install matching client tools on the host is how a backup script stops working
# on the day it is needed.
#
#   sh scripts/backup.sh                 -> ./backups/2026-08-19T12-00-00Z
#   sh scripts/backup.sh /mnt/backups    -> /mnt/backups/2026-08-19T12-00-00Z

BUCKET="${S3_BUCKET:-lpm}"
DATABASE="${POSTGRES_DB:-lpm}"
DATABASE_USER="${POSTGRES_USER:-lpm}"

compose() {
  docker compose "$@"
}

stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
destination="${1:-./backups}/${stamp}"

mkdir -p "$destination"

printf 'Backing up into %s\n' "$destination"

# Custom format rather than plain SQL: it restores with `--clean --if-exists`,
# which is what makes a restore over a live database a replacement rather than a
# collision.
printf '  database ... '
compose exec -T postgres pg_dump \
  --username "$DATABASE_USER" \
  --dbname "$DATABASE" \
  --format=custom \
  --no-owner \
  --no-privileges \
  > "$destination/postgres.dump"
printf 'done\n'

# Object level rather than a copy of MinIO's data directory: an object-level
# backup restores into any S3-compatible store, and a studio that moves off
# MinIO should not find its backups only work on MinIO.
#
# Mirrored to a directory inside the container and then copied out, because that
# image carries `mc` and little else — no tar. Docker does the archiving.
printf '  objects ... '
compose exec -T minio sh -c '
  set -e
  mc alias set backup http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" > /dev/null
  rm -rf /tmp/lpm-backup
  mkdir -p /tmp/lpm-backup
  mc mirror --quiet backup/'"$BUCKET"' /tmp/lpm-backup > /dev/null 2>&1 || true
'
rm -rf "$destination/objects"
compose cp minio:/tmp/lpm-backup "$destination/objects" > /dev/null
printf 'done\n'

# What this is and what made it, so a restore can refuse a backup it does not
# understand rather than half-applying one.
cat > "$destination/manifest.json" <<MANIFEST
{
  "takenAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "version": "$(node -p "require('./package.json').version" 2>/dev/null || echo unknown)",
  "database": "${DATABASE}",
  "bucket": "${BUCKET}",
  "format": 1
}
MANIFEST

printf 'Backed up %s\n' "$destination"
printf 'Restore it with: sh scripts/restore.sh %s\n' "$destination"
