#!/bin/sh
set -eu

# Puts a backup back, over whatever is there now.
#
# Destructive by definition — a restore that kept the current data would not be
# a restore — so it says what it is about to replace and asks, unless told not
# to with `--yes`.
#
# The app and the worker are stopped first. Restoring underneath a running
# server means it holds rows that no longer exist and caches a board that has
# been replaced, and the first write afterwards is against a database it has the
# wrong idea about.
#
#   sh scripts/restore.sh ./backups/2026-08-19T12-00-00Z
#   sh scripts/restore.sh ./backups/2026-08-19T12-00-00Z --yes

BUCKET="${S3_BUCKET:-lpm}"
DATABASE="${POSTGRES_DB:-lpm}"
DATABASE_USER="${POSTGRES_USER:-lpm}"

compose() {
  docker compose "$@"
}

source_directory="${1:-}"
confirmed="${2:-}"

if [ -z "$source_directory" ]; then
  printf 'Which backup? sh scripts/restore.sh <directory> [--yes]\n' >&2
  exit 2
fi

if [ ! -f "$source_directory/postgres.dump" ] || [ ! -d "$source_directory/objects" ]; then
  printf 'Not a backup: %s has no postgres.dump and objects in it\n' "$source_directory" >&2
  exit 2
fi

if [ "$confirmed" != "--yes" ]; then
  printf 'This replaces the database and the object store of the install in this\n'
  printf 'directory with the contents of %s.\n\n' "$source_directory"
  printf 'Everything currently in them is lost. Re-run with --yes to go ahead.\n'
  exit 1
fi

printf 'Restoring from %s\n' "$source_directory"

# Nothing may be writing while this happens.
printf '  stopping the app ... '
compose stop app worker > /dev/null 2>&1 || true
printf 'done\n'

# `--clean --if-exists` drops what it is about to recreate, so this is a
# replacement rather than a merge with whatever was there.
printf '  database ... '
compose exec -T postgres pg_restore \
  --username "$DATABASE_USER" \
  --dbname "$DATABASE" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  < "$source_directory/postgres.dump"
printf 'done\n'

# `--remove` so an object created after the backup does not survive it. A
# restore that left files behind would leave the store and the database
# disagreeing about what exists, which is the thing this is for.
printf '  objects ... '
compose exec -T minio rm -rf /tmp/lpm-restore
compose cp "$source_directory/objects" minio:/tmp/lpm-restore > /dev/null
compose exec -T minio sh -c '
  set -e
  mc alias set backup http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" > /dev/null
  mc mb --ignore-existing backup/'"$BUCKET"' > /dev/null
  mc mirror --quiet --overwrite --remove /tmp/lpm-restore backup/'"$BUCKET"' > /dev/null 2>&1 || true
'
printf 'done\n'

printf '  starting the app ... '
compose --profile app up -d --wait > /dev/null 2>&1
printf 'done\n'

printf 'Restored %s\n' "$source_directory"
