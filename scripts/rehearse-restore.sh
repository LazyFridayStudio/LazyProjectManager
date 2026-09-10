#!/bin/sh
set -eu

# Proves the backup can actually be restored, by destroying an install and
# putting it back.
#
# A backup nobody has ever restored is a guess. The failure everybody has seen is
# the one where the dump ran nightly for two years and the restore turns out to
# need a flag nobody knew about — so this runs the real scripts, wipes the real
# database and bucket, and checks what comes back.
#
# It is destructive on purpose. Run it against a scratch install or in CI, never
# against one with work in it.
#
#   sh scripts/rehearse-restore.sh

BUCKET="${S3_BUCKET:-lpm}"
DATABASE="${POSTGRES_DB:-lpm}"
DATABASE_USER="${POSTGRES_USER:-lpm}"

MARKER_OBJECT='rehearsal/marker.txt'
MARKER_TEXT='this object existed when the backup was taken'

WORKSPACE="${TMPDIR:-/tmp}/lpm-rehearsal"

compose() {
  docker compose "$@"
}

psql_query() {
  compose exec -T postgres psql \
    --username "$DATABASE_USER" \
    --dbname "$DATABASE" \
    --tuples-only \
    --no-align \
    --command "$1"
}

minio_shell() {
  compose exec -T minio sh -c "
    mc alias set rehearsal http://127.0.0.1:9000 \"\$MINIO_ROOT_USER\" \"\$MINIO_ROOT_PASSWORD\" > /dev/null
    $1
  "
}

fail() {
  printf '\nREHEARSAL FAILED: %s\n' "$1" >&2
  exit 1
}

printf 'Rehearsing a restore. This destroys the install in this directory.\n\n'

# --- Something to lose -------------------------------------------------------

printf 'Putting a marker in the store … '
minio_shell "
  mc mb --ignore-existing rehearsal/${BUCKET} > /dev/null
  printf '%s' '${MARKER_TEXT}' | mc pipe rehearsal/${BUCKET}/${MARKER_OBJECT} > /dev/null
"
printf 'done\n'

# The migration table is the one thing every install has, whether or not
# anybody has signed in yet — so the rehearsal works on an empty install as
# well as a full one.
before_migrations=$(psql_query 'select count(*) from kysely_migration' | tr -d '[:space:]')
before_tables=$(psql_query "select count(*) from information_schema.tables where table_schema = 'public'" | tr -d '[:space:]')

printf 'Before: %s migrations across %s tables\n' "$before_migrations" "$before_tables"

# --- Back it up --------------------------------------------------------------

rm -rf "$WORKSPACE"
mkdir -p "$WORKSPACE"
sh scripts/backup.sh "$WORKSPACE"

backup=$(ls -d "$WORKSPACE"/*/ | head -1)
backup="${backup%/}"

# --- Lose it -----------------------------------------------------------------

printf 'Destroying the database and the bucket … '
psql_query 'drop schema public cascade; create schema public;' > /dev/null
minio_shell "mc rm --recursive --force rehearsal/${BUCKET} > /dev/null 2>&1 || true"
printf 'done\n'

emptied=$(psql_query "select count(*) from information_schema.tables where table_schema = 'public'" | tr -d '[:space:]')

if [ "$emptied" != "0" ]; then
  fail "the database was supposed to be empty and has $emptied tables"
fi

# --- Put it back -------------------------------------------------------------

sh scripts/restore.sh "$backup" --yes

# --- Check ------------------------------------------------------------------

after_migrations=$(psql_query 'select count(*) from kysely_migration' | tr -d '[:space:]')
after_tables=$(psql_query "select count(*) from information_schema.tables where table_schema = 'public'" | tr -d '[:space:]')

printf 'After:  %s migrations across %s tables\n' "$after_migrations" "$after_tables"

[ "$after_migrations" = "$before_migrations" ] ||
  fail "migrations: expected $before_migrations, found $after_migrations"

[ "$after_tables" = "$before_tables" ] ||
  fail "tables: expected $before_tables, found $after_tables"

restored_marker=$(minio_shell "mc cat rehearsal/${BUCKET}/${MARKER_OBJECT} 2> /dev/null" || true)

[ "$restored_marker" = "$MARKER_TEXT" ] ||
  fail "the object in the store did not come back (found '${restored_marker}')"

# The restore starts the app again, and the image runs migrations on the way up.
# A healthy answer here is the upgrade path proving itself: the process booted
# against the restored database, found the schema it expected, and said so.
printf 'Asking the app whether it came back ... '
health=$(compose exec -T app node -e "
  fetch('http://127.0.0.1:3000/health')
    .then((response) => response.text())
    .then((body) => process.stdout.write(body))
    .catch(() => process.stdout.write('unreachable'));
" 2>/dev/null || printf 'unreachable')

case "$health" in
  *ok*) printf 'yes\n' ;;
  *) fail "the app did not come back healthy (said '${health}')" ;;
esac

rm -rf "$WORKSPACE"

printf '\nThe install was destroyed and put back from its backup.\n'
