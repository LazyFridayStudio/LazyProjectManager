import { sql, type Kysely } from 'kysely';

/**
 * What a team may do, as a list of allowed and denied actions.
 *
 * `team_grant` says *where* — which projects and portfolios a team reaches, and
 * whether it reaches them at all. This says *what*: whether the people in it may
 * move a card, or only write in one.
 *
 * The two are deliberately separate. Folding them together would mean saying
 * every action about every project — a hundred projects times twenty actions is
 * a screen nobody can hold in their head — and folding this into `read | write`
 * is the thing being fixed: today anybody who may move a card may also edit it,
 * rename the list and delete it, because all four are `write`.
 *
 * A group rather than rules straight on a team, because the same set is wanted
 * for several teams — three outsourcing partners with the same arrangement — and
 * a change to what an outsourcer may do should be one edit rather than three.
 *
 * `effect` is text with a check rather than an enum: adding a third one later
 * would otherwise need a migration for a value the application already knows.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await createGroups(database);
  await createRules(database);
  await createTeamGroups(database);
}

async function createGroups(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('permission_group')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  // One name per install: two groups called "Outsourcer" is two things nobody
  // can tell apart on the screen that gives them out.
  await sql`
    create unique index permission_group_by_name_idx
    on permission_group (account_id, lower(name))
  `.execute(database);
}

async function createRules(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('permission_rule')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('group_id', 'uuid', (column) =>
      column.notNull().references('permission_group.id').onDelete('cascade'),
    )
    /**
     * An action name, or a coarse rule standing for a set of them.
     *
     * Stored as what was chosen rather than expanded into its members, so an
     * action added later is covered by every group that holds the coarse rule
     * instead of quietly missing from all of them.
     */
    .addColumn('action', 'text', (column) => column.notNull())
    .addColumn('effect', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    alter table permission_rule
    add constraint permission_rule_effect_known
    check (effect in ('allow', 'deny'))
  `.execute(database);

  // One rule per action per group. Saying the same action twice in one group is
  // either a mistake or a contradiction, and neither should be storable.
  await sql`
    create unique index permission_rule_by_action_idx
    on permission_rule (group_id, action)
  `.execute(database);
}

async function createTeamGroups(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('team_permission_group')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (column) =>
      column.notNull().references('team.id').onDelete('cascade'),
    )
    .addColumn('group_id', 'uuid', (column) =>
      column.notNull().references('permission_group.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    create unique index team_permission_group_idx
    on team_permission_group (team_id, group_id)
  `.execute(database);

  // The read this is for: every rule reaching one person, gathered through the
  // teams they are in, on every request.
  await sql`
    create index team_permission_group_by_group_idx
    on team_permission_group (group_id)
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('team_permission_group').ifExists().execute();
  await database.schema.dropTable('permission_rule').ifExists().execute();
  await database.schema.dropTable('permission_group').ifExists().execute();
}
