import { sql, type Kysely } from 'kysely';

/**
 * How long the clock leaves a repository alone between reconciles.
 *
 * It was half an hour, written as a constant in the worker, and half an hour is
 * long enough that a board is stale for most of a working day even when nothing
 * is broken. A studio living in one repository wants a minute; an install with
 * forty projects on it does not want forty projects asked every minute against
 * somebody else's rate limit. That is a decision with two right answers, which
 * makes it a setting rather than a better constant.
 *
 * On the project rather than on the connection, for the reason
 * `sync_open_issues_only` gives beside it: it is a thing a studio decides about
 * its board rather than about the credentials it reads with. A project holds
 * exactly one repository — `scm_connection.project_id` is unique — so per
 * project is per repository anyway.
 *
 * **Null means the clock is off**, and the button and the webhook still work. A
 * project nobody is watching is a real answer, and an interval of "never" written
 * as a very large number would be a number somebody has to decode.
 *
 * Seconds rather than minutes because the floor is the interesting end and the
 * check constraint can say it plainly. The default backfills every project that
 * already exists to a minute, which is the whole point of the change.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('project')
    .addColumn('sync_every_seconds', 'integer', (column) => column.defaultTo(sql`60`))
    .execute();

  // A minute is the fastest, because the cost of a sync is a handful of requests
  // against a rate limit that is not ours. The screen offers a short list; this
  // is the floor underneath whatever the screen grows to offer.
  await database.schema
    .alterTable('project')
    .addCheckConstraint(
      'project_sync_every_seconds_is_a_minute_or_more',
      sql`sync_every_seconds is null or sync_every_seconds >= 60`,
    )
    .execute();
}

/**
 * The column goes and the clock is half an hour again for everybody.
 *
 * Nothing is lost that cannot be said again: a project set to Off would start
 * being synced on the clock, which is the behaviour before this existed.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('project')
    .dropConstraint('project_sync_every_seconds_is_a_minute_or_more')
    .execute();

  await database.schema.alterTable('project').dropColumn('sync_every_seconds').execute();
}
