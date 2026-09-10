import { sql, type Kysely } from 'kysely';

/**
 * Where a card came from.
 *
 * Everything on a board was typed by somebody until now. Once a repository can
 * put its issues on it, the two have to be told apart — because they are
 * protected differently: a card somebody wrote is never touched by a sync, and a
 * card the forge owns is refreshed from it every time.
 *
 * `hand` for every card already there. Nobody wrote those under a forge's name,
 * and defaulting them to one would hand a sync permission to rewrite the board.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('card')
    .addColumn('source', 'text', (column) => column.notNull().defaultTo('hand'))
    .execute();

  /**
   * The forge's own id for the issue.
   *
   * Matched on rather than the number, because a number belongs to a repository
   * and a card can outlive the repository it came from. Null for anything
   * written by hand, which has no forge to have an id from.
   */
  await database.schema.alterTable('card').addColumn('external_id', 'text').execute();

  /** `41`, as the issue is spoken about. Shown; never matched on. */
  await database.schema.alterTable('card').addColumn('external_ref', 'text').execute();

  /** Where to go to read the thing itself. */
  await database.schema.alterTable('card').addColumn('external_url', 'text').execute();

  // One card per issue, per project. Partial, so the hand-written cards — which
  // all have no external id — are not competing for a single null slot.
  await sql`
    create unique index card_by_source_idx
    on card (project_id, source, external_id)
    where external_id is not null
  `.execute(database);

  /**
   * When issues were last read from the repository.
   *
   * On the connection beside `releases_synced_at`, for the same reason: it is a
   * fact about the link to the forge, and it is null until somebody has actually
   * pulled once — which is how a screen tells "never synced" from "synced and
   * there was nothing".
   */
  await database.schema
    .alterTable('scm_connection')
    .addColumn('issues_synced_at', 'timestamptz')
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('scm_connection').dropColumn('issues_synced_at').execute();
  await sql`drop index if exists card_by_source_idx`.execute(database);

  for (const column of ['external_url', 'external_ref', 'external_id', 'source']) {
    await database.schema.alterTable('card').dropColumn(column).execute();
  }
}
