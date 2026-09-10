import { sql, type Kysely } from 'kysely';

/**
 * Projects, their members, and the counters that issue ticket keys.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */

const PROJECT_PHASES = [
  'prototype',
  'pre_production',
  'production',
  'vertical_slice',
  'content_complete',
  'alpha',
  'beta',
  'shipped',
] as const;

const PROJECT_ROLES = ['owner', 'lead', 'member', 'outsourcer', 'viewer'] as const;

/**
 * The ticket prefixes every project starts with, matching the card types on the
 * board. A project's keys read DRCH-ART-208 style: the project code, the type
 * prefix, then the number this counter hands out.
 */
const CARD_SEQUENCE_PREFIXES = ['ART', 'TASK', 'BUG', 'BUILD'] as const;

export async function up(database: Kysely<unknown>): Promise<void> {
  await createProjectTable(database);
  await createProjectMemberTable(database);
  await createCardSequenceTable(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  for (const tableName of ['card_sequence', 'project_member', 'project']) {
    await database.schema.dropTable(tableName).ifExists().execute();
  }
}

async function createProjectTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('project')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (column) => column.notNull())
    // The ticket prefix root: DRCH gives DRCH-ART-208.
    .addColumn('code', 'text', (column) => column.notNull())
    .addColumn('slug', 'text', (column) => column.notNull())
    .addColumn('engine', 'text')
    .addColumn('phase', 'text', (column) => column.notNull().defaultTo('prototype'))
    // Minor units, so money is integer arithmetic everywhere and formatting
    // happens once at the edge.
    .addColumn('budget_minor', 'bigint')
    .addColumn('currency', 'char(3)', (column) => column.notNull().defaultTo('AUD'))
    .addColumn('starts_on', 'date')
    .addColumn('ships_on', 'date')
    // A project can exist before anyone will commit to dates.
    .addColumn('dates_tbd', 'boolean', (column) => column.notNull().defaultTo(false))
    .addColumn('key_art_file_id', 'uuid')
    .addColumn('archived_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    // Two projects in one account cannot share a code, or their ticket keys
    // would collide.
    .addUniqueConstraint('project_code_unique_per_account', ['account_id', 'code'])
    .addUniqueConstraint('project_slug_unique_per_account', ['account_id', 'slug'])
    .addCheckConstraint(
      'project_phase_known',
      sql`phase in (${sql.join(PROJECT_PHASES.map((phase) => sql.lit(phase)))})`,
    )
    // Uppercase letters and digits, starting with a letter. This is what makes a
    // ticket key readable at a glance.
    .addCheckConstraint('project_code_shape', sql`code ~ '^[A-Z][A-Z0-9]{1,9}$'`)
    .addCheckConstraint(
      'project_budget_not_negative',
      sql`budget_minor is null or budget_minor >= 0`,
    )
    .execute();

  // The launcher lists a single account's live projects, most recently touched
  // first, which is the order it renders them in.
  await sql`
    create index project_live_idx on project (account_id, updated_at desc)
      where archived_at is null
  `.execute(database);
}

async function createProjectMemberTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('project_member')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('project_id', 'uuid', (column) =>
      column.notNull().references('project.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (column) =>
      column.notNull().references('app_user.id').onDelete('cascade'),
    )
    .addColumn('role', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('project_member_one_role_per_project', ['project_id', 'user_id'])
    .addCheckConstraint(
      'project_member_role_known',
      sql`role in (${sql.join(PROJECT_ROLES.map((role) => sql.lit(role)))})`,
    )
    .execute();

  await database.schema
    .createIndex('project_member_by_user_idx')
    .on('project_member')
    .columns(['user_id', 'project_id'])
    .execute();
}

async function createCardSequenceTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('card_sequence')
    .addColumn('project_id', 'uuid', (column) =>
      column.notNull().references('project.id').onDelete('cascade'),
    )
    .addColumn('prefix', 'text', (column) => column.notNull())
    // A row per prefix rather than a Postgres sequence: keys must have no gaps,
    // and a sequence keeps its consumed value when a transaction rolls back.
    .addColumn('last_value', 'integer', (column) => column.notNull().defaultTo(0))
    .addPrimaryKeyConstraint('card_sequence_pkey', ['project_id', 'prefix'])
    .addCheckConstraint(
      'card_sequence_prefix_known',
      sql`prefix in (${sql.join(CARD_SEQUENCE_PREFIXES.map((prefix) => sql.lit(prefix)))})`,
    )
    .addCheckConstraint('card_sequence_not_negative', sql`last_value >= 0`)
    .execute();
}
