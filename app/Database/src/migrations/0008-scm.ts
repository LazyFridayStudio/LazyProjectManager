import { sql, type Kysely } from 'kysely';

/**
 * A project's repository, and everything that repository has told us.
 *
 * Two tables with one job between them: know where the code lives, and never
 * lose an event that arrived. What an event *means* is worked out later, from
 * the payload kept here — so a parser that turns out to be wrong can be fixed
 * and re-run against what actually happened, rather than against what an
 * earlier version of it decided to keep.
 */

const PROVIDERS = ['github', 'gitea', 'gitlab'] as const;

export async function up(database: Kysely<unknown>): Promise<void> {
  await createScmConnectionTable(database);
  await createScmEventRawTable(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  for (const tableName of ['scm_event_raw', 'scm_connection']) {
    await database.schema.dropTable(tableName).ifExists().execute();
  }
}

async function createScmConnectionTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('scm_connection')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    /**
     * One repository per project.
     *
     * A card key belongs to exactly one project, so a commit naming it has
     * exactly one place to land. Two repositories on one project would make
     * that ambiguous before anything had been built to resolve it.
     */
    .addColumn('project_id', 'uuid', (column) =>
      column.notNull().unique().references('project.id').onDelete('cascade'),
    )
    .addColumn('provider', 'text', (column) => column.notNull())
    /** `studio/saltmarsh` — owner and repository, as the provider spells it. */
    .addColumn('repo_full_name', 'text', (column) => column.notNull())
    /** Null for the provider's own host; set for a self-hosted Gitea or GitLab. */
    .addColumn('endpoint', 'text')
    /**
     * Encrypted, not hashed: verifying a signature means computing the same
     * HMAC the sender did, which needs the secret itself rather than a proof of
     * it.
     */
    .addColumn('webhook_secret_enc', 'text', (column) => column.notNull())
    .addColumn('connected_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('connected_by', 'uuid', (column) =>
      column.references('app_user.id').onDelete('set null'),
    )
    /** Null until the first delivery, which is how "is this wired up?" is answered. */
    .addColumn('last_event_at', 'timestamptz')
    .addCheckConstraint(
      'scm_connection_provider_known',
      sql`provider in (${sql.join(PROVIDERS.map((provider) => sql.lit(provider)))})`,
    )
    .execute();
}

async function createScmEventRawTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('scm_event_raw')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('connection_id', 'uuid', (column) =>
      column.notNull().references('scm_connection.id').onDelete('cascade'),
    )
    /** The provider's own id for the delivery, which is what makes a retry safe. */
    .addColumn('delivery_id', 'text', (column) => column.notNull())
    /** `push`, `pull_request`, and everything else it may send. */
    .addColumn('event_name', 'text', (column) => column.notNull())
    .addColumn('payload', 'jsonb', (column) => column.notNull())
    .addColumn('received_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    /** Null until the worker has read it. */
    .addColumn('processed_at', 'timestamptz')
    .execute();

  // A provider that gets no answer resends the same delivery. Landing it twice
  // would double every commit on a card.
  await database.schema
    .createIndex('scm_event_raw_delivery_idx')
    .on('scm_event_raw')
    .columns(['connection_id', 'delivery_id'])
    .unique()
    .execute();

  // The worker's queue: everything that has arrived and not yet been read.
  await sql`
    create index scm_event_raw_unprocessed_idx
      on scm_event_raw (received_at)
      where processed_at is null
  `.execute(database);
}
