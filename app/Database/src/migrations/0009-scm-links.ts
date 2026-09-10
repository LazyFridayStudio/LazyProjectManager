import { sql, type Kysely } from 'kysely';

/**
 * What a repository said about a card.
 *
 * Written by the worker from the deliveries kept in `scm_event_raw`, never by a
 * request. Derived rather than authoritative: the raw payload is the record, and
 * this is one reading of it — so a parser that turns out to be wrong can have
 * these rows cleared and rebuilt without anything being lost.
 */

const LINK_KINDS = ['commit', 'branch', 'pull_request', 'lfs_object'] as const;

export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('scm_link')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('card_id', 'uuid', (column) =>
      column.notNull().references('card.id').onDelete('cascade'),
    )
    .addColumn('connection_id', 'uuid', (column) =>
      column.notNull().references('scm_connection.id').onDelete('cascade'),
    )
    .addColumn('kind', 'text', (column) => column.notNull())
    /** The commit sha, the branch name, or `#41` — whatever names this thing. */
    .addColumn('ref', 'text', (column) => column.notNull())
    .addColumn('url', 'text')
    .addColumn('author', 'text')
    .addColumn('message', 'text')
    /** When it happened in the repository, not when we heard about it. */
    .addColumn('occurred_at', 'timestamptz', (column) => column.notNull())
    .addCheckConstraint(
      'scm_link_kind_known',
      sql`kind in (${sql.join(LINK_KINDS.map((kind) => sql.lit(kind)))})`,
    )
    .execute();

  // The same commit is delivered again whenever a provider retries, and named
  // again by every branch it is pushed to. One row per thing, per card.
  await database.schema
    .createIndex('scm_link_identity_idx')
    .on('scm_link')
    .columns(['card_id', 'connection_id', 'kind', 'ref'])
    .unique()
    .execute();

  // How the card detail reads it: newest first, for one card.
  await sql`
    create index scm_link_card_idx on scm_link (card_id, occurred_at desc)
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('scm_link').ifExists().execute();
}
