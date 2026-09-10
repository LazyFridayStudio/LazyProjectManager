import type { Kysely } from 'kysely';

/**
 * A person can have a face, and it is a file like every other.
 *
 * `app_user.avatar_url` has been here since the first migration and nothing has
 * ever written it. It was a text column holding an address, which is the shape
 * that made sense when a picture might have come from somewhere else — and is
 * the wrong one now: every other picture in the product is a `file` row, gets a
 * thumbnail from the worker, and is read at `/api/f/<id>` with the permission
 * checked on the way past. A bare URL has none of that.
 *
 * So it goes, and a file id takes its place, the way `project.logo_file_id`
 * already does. Nothing is lost with it: the column was null on every row of
 * every install, because no code path has ever set it.
 *
 * Plain uuid rather than a foreign key, matching the two on `project`: files
 * are never deleted out from under the thing pointing at them, and a left join
 * already reads a missing one as no picture.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('app_user').addColumn('avatar_file_id', 'uuid').execute();
  await database.schema.alterTable('app_user').dropColumn('avatar_url').execute();
}

/**
 * The text column comes back, empty, and the pictures do not.
 *
 * Which loses nothing that was ever there: rolling back gives every row the
 * null it has always had. Anybody who chose a picture between this running and
 * being rolled back is back to their initials, and the file itself is still in
 * the store.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('app_user').addColumn('avatar_url', 'text').execute();
  await database.schema.alterTable('app_user').dropColumn('avatar_file_id').execute();
}
