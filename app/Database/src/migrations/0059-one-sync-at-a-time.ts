import { type Kysely } from 'kysely';

/**
 * What a connection's sync is doing, and how the last one went.
 *
 * Three columns and one subject, which is why they are one migration.
 *
 * **`syncing_since` is the claim.** Nothing has ever stopped two syncs of one
 * project running at once: the button is in the API container and the clock is
 * in the worker, so those two could always collide, and at a one-minute interval
 * a sync of a repository with a hundred issues will not reliably finish before
 * the next one starts. A sync claims its connection by setting this and clears
 * it when it is done.
 *
 * A column rather than an advisory lock because a sync is not one transaction —
 * it reads the forge, writes the database, then writes back to the forge — so a
 * transaction-scoped lock cannot cover it, and a session lock would mean pinning
 * a pool connection across network calls. One conditional `update … returning`
 * holds nothing open and is decided by the database rather than by two processes
 * agreeing.
 *
 * It carries a lease, read by the code that claims it: a claim older than the
 * longest a sync could plausibly take is taken over. Without that, a worker
 * killed mid-sync would leave a connection nothing could ever sync again.
 *
 * **`sync_failed_at` and `sync_failure` are why.** `issues_synced_at` moves only
 * on a sync that worked, so a repository whose every attempt fails shows an
 * ageing "synced N hours ago" and nothing else — which reads exactly like a quiet
 * repository. The failure went to the worker's stderr, where nobody using the
 * product is looking. Both are cleared by the next sync that works, so what the
 * screen shows is the current state rather than a scar.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('scm_connection')
    .addColumn('syncing_since', 'timestamptz')
    .execute();

  await database.schema
    .alterTable('scm_connection')
    .addColumn('sync_failed_at', 'timestamptz')
    .execute();

  await database.schema.alterTable('scm_connection').addColumn('sync_failure', 'text').execute();
}

/**
 * The claim and the reason go; the timestamp that says a sync worked stays.
 *
 * Nothing is lost. A claim is about a sync in flight right now, and a reason is
 * about one that has already failed — both are said again the next time either
 * happens.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  for (const column of ['syncing_since', 'sync_failed_at', 'sync_failure']) {
    await database.schema.alterTable('scm_connection').dropColumn(column).execute();
  }
}
