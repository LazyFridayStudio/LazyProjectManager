import type { Kysely } from 'kysely';

/**
 * When the forge last said something the board has not caught up with.
 *
 * A closed issue reached the board only when the half-hourly sweep came round,
 * because the delivery that said so was read for the cards it named and thrown
 * away otherwise. Squash-merging a pull request with `Closes #255` in it left
 * the board saying the work was open for up to thirty minutes, with nothing on
 * screen to say it was behind.
 *
 * The delivery had already arrived. This is where it is written down: a
 * webhook sets this, and the sweep treats a connection whose last word from the
 * forge is newer than its last reconcile as due now rather than in half an
 * hour.
 *
 * **Not `issues_synced_at` with an older time.** That column is what the board
 * header reads to say `synced 4 minutes ago`, and winding it back to force a
 * pass would make the app lie about when it last looked. Two facts, two
 * columns: when we last reconciled, and when the forge last said something.
 *
 * **A time rather than a flag**, so the comparison is against the reconcile
 * that followed it. A boolean would have to be cleared by whatever consumed it,
 * and a sync that failed halfway would clear a flag it had not earned.
 *
 * Null on every existing connection, which reads as "nothing outstanding" — the
 * state every connection is in until the next delivery arrives.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('scm_connection')
    .addColumn('forge_spoke_at', 'timestamptz')
    .execute();
}

/**
 * The column goes, and the sweep is back to the clock alone.
 *
 * Nothing is lost that a sync does not work out again: which cards match which
 * issues is read from the forge every pass, so a board that was waiting on this
 * is a board that waits half an hour instead.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('scm_connection').dropColumn('forge_spoke_at').execute();
}
