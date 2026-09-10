import { sql, type Kysely } from 'kysely';

/**
 * The identity, tenancy and outbox foundation from `DOMAIN_MODEL.md`.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is written in snake_case exactly as it lands in
 * Postgres. That keeps the schema builder and the raw `sql` fragments below
 * speaking the same language.
 */

const MEMBERSHIP_ROLES = ['owner', 'lead', 'member', 'outsourcer', 'viewer'] as const;
const USER_STATUSES = ['active', 'invited', 'suspended'] as const;

export async function up(database: Kysely<unknown>): Promise<void> {
  // citext gives case-insensitive email uniqueness in the index itself, so no
  // call site has to remember to lowercase before comparing.
  await sql`create extension if not exists citext`.execute(database);

  await createAccountTable(database);
  await createAppUserTable(database);
  await createMembershipTable(database);
  await createSessionTable(database);
  await createInstallSettingsTable(database);
  await createCommandLogTable(database);
  await createDomainEventTable(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  // Dropped in reverse dependency order so the foreign keys never block a drop.
  for (const tableName of [
    'domain_event',
    'command_log',
    'install_settings',
    'session',
    'membership',
    'app_user',
    'account',
  ]) {
    await database.schema.dropTable(tableName).ifExists().execute();
  }
}

async function createAccountTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('account')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('slug', 'text', (column) => column.notNull().unique())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();
}

/**
 * Named `app_user` because `user` is a reserved word in Postgres; using it would
 * force double-quoting in every statement that touches the table.
 */
async function createAppUserTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('app_user')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('email', sql`citext`, (column) => column.notNull().unique())
    .addColumn('password_hash', 'text', (column) => column.notNull())
    .addColumn('display_name', 'text', (column) => column.notNull())
    .addColumn('initials', 'text', (column) => column.notNull())
    .addColumn('avatar_url', 'text')
    .addColumn('status', 'text', (column) => column.notNull().defaultTo('active'))
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('last_seen_at', 'timestamptz')
    .addCheckConstraint(
      'app_user_status_known',
      sql`status in (${sql.join(USER_STATUSES.map((status) => sql.lit(status)))})`,
    )
    .execute();
}

async function createMembershipTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('membership')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (column) =>
      column.notNull().references('app_user.id').onDelete('cascade'),
    )
    .addColumn('role', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('membership_one_role_per_account', ['account_id', 'user_id'])
    .addCheckConstraint(
      'membership_role_known',
      sql`role in (${sql.join(MEMBERSHIP_ROLES.map((role) => sql.lit(role)))})`,
    )
    .execute();
}

async function createSessionTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('session')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (column) =>
      column.notNull().references('app_user.id').onDelete('cascade'),
    )
    // Only the hash is stored, so a database dump does not hand over live sessions.
    .addColumn('token_hash', 'text', (column) => column.notNull().unique())
    .addColumn('expires_at', 'timestamptz', (column) => column.notNull())
    .addColumn('user_agent', 'text')
    .addColumn('ip_address', sql`inet`)
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await database.schema
    .createIndex('session_expires_at_idx')
    .on('session')
    .column('expires_at')
    .execute();
}

async function createInstallSettingsTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('install_settings')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('server_name', 'text', (column) => column.notNull())
    .addColumn('base_url', 'text', (column) => column.notNull())
    .addColumn('setup_completed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  // An install describes exactly one server. Indexing a constant expression is
  // the cheapest way to make a second row impossible at the database level.
  await sql`create unique index install_settings_singleton on install_settings ((true))`.execute(
    database,
  );
}

async function createCommandLogTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('command_log')
    // The client-generated command id is the primary key, so a retried command
    // conflicts here instead of applying its write a second time.
    .addColumn('command_id', 'uuid', (column) => column.primaryKey())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('actor_id', 'uuid', (column) =>
      column.references('app_user.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();
}

async function createDomainEventTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('domain_event')
    // UUIDv7, generated by the command handler, so the key sorts by time.
    .addColumn('id', 'uuid', (column) => column.primaryKey())
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('aggregate_type', 'text', (column) => column.notNull())
    .addColumn('aggregate_id', 'uuid', (column) => column.notNull())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('payload', 'jsonb', (column) => column.notNull())
    .addColumn('actor_id', 'uuid', (column) =>
      column.references('app_user.id').onDelete('set null'),
    )
    .addColumn('occurred_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('processed_at', 'timestamptz')
    .execute();

  // The worker's drain query only ever looks at unprocessed rows. A partial
  // index keeps it O(backlog) rather than O(all events ever emitted).
  await sql`
    create index domain_event_unprocessed_idx
      on domain_event (occurred_at)
      where processed_at is null
  `.execute(database);

  await database.schema
    .createIndex('domain_event_aggregate_idx')
    .on('domain_event')
    .columns(['aggregate_type', 'aggregate_id', 'occurred_at'])
    .execute();
}
