import { sql, type Kysely } from 'kysely';

/**
 * The board: one per project, its lists, and the cards on them.
 *
 * As in every migration, identifiers are snake_case by hand — the
 * `CamelCasePlugin` is not installed on the connection this runs against — and
 * the literals in check constraints are repeated rather than imported, because a
 * migration is a frozen record of what already ran.
 */

const CARD_TYPES = ['art', 'task', 'bug', 'build'] as const;
const CARD_PRIORITIES = ['highest', 'high', 'medium', 'low'] as const;

/**
 * The lists a new board starts with, matching the prototype's board exactly.
 *
 * A board with no lists is a board nothing can be put on, so every project gets
 * these and can rename or remove them afterwards.
 */
const DEFAULT_LISTS = [
  { name: 'Backlog', color: '#adadad', wipLimit: null, position: 1000 },
  { name: 'In progress', color: '#f0de8a', wipLimit: 8, position: 2000 },
  { name: 'Ready for review', color: '#63aeeb', wipLimit: 4, position: 3000 },
  { name: 'Done', color: '#63eba3', wipLimit: null, position: 4000 },
] as const;

export async function up(database: Kysely<unknown>): Promise<void> {
  await createBoardTable(database);
  await createListTable(database);
  await createCardTable(database);
  await giveExistingProjectsABoard(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  for (const tableName of ['card', 'list', 'board']) {
    await database.schema.dropTable(tableName).ifExists().execute();
  }
}

async function createBoardTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('board')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('project_id', 'uuid', (column) =>
      column.notNull().references('project.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (column) => column.notNull().defaultTo('Board'))
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    // One board per project for now. The column is here rather than on `project`
    // so a second board is a row instead of a migration; the constraint is what
    // says only one exists today.
    .addUniqueConstraint('board_one_per_project', ['project_id'])
    .execute();
}

async function createListTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('list')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('board_id', 'uuid', (column) =>
      column.notNull().references('board.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (column) => column.notNull())
    /** The colour bar at the top of the list, and the tint behind its cards. */
    .addColumn('color', 'text', (column) => column.notNull().defaultTo('#adadad'))
    /** Null means no limit. Zero would mean nothing may be in this list at all. */
    .addColumn('wip_limit', 'integer')
    // Numeric rather than an integer sequence: a card or list dropped between
    // two others takes the midpoint, so a reorder writes one row instead of
    // renumbering everything after it.
    .addColumn('position', 'numeric', (column) => column.notNull())
    .addColumn('archived_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('list_wip_limit_positive', sql`wip_limit is null or wip_limit > 0`)
    .addCheckConstraint('list_color_is_hex', sql`color ~ '^#[0-9a-f]{6}$'`)
    .execute();

  await sql`
    create index list_on_board_idx on list (board_id, position)
      where archived_at is null
  `.execute(database);
}

async function createCardTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('card')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // Denormalised from `project` so every board query can be scoped to the
    // account without a join it would otherwise need on every single row.
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('project_id', 'uuid', (column) =>
      column.notNull().references('project.id').onDelete('cascade'),
    )
    .addColumn('list_id', 'uuid', (column) => column.notNull().references('list.id'))
    /** `DRCH-ART-208`. Issued by `card_sequence` and never reused. */
    .addColumn('card_key', 'text', (column) => column.notNull())
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('description', 'text')
    .addColumn('acceptance_criteria', 'text')
    .addColumn('type', 'text', (column) => column.notNull())
    .addColumn('priority', 'text')
    .addColumn('points', 'integer')
    .addColumn('estimate_minutes', 'integer')
    .addColumn('assignee_id', 'uuid', (column) => column.references('app_user.id'))
    .addColumn('reporter_id', 'uuid', (column) => column.references('app_user.id'))
    .addColumn('discipline', 'text')
    .addColumn('fix_version', 'text')
    .addColumn('due_on', 'date')
    .addColumn('blocked', 'boolean', (column) => column.notNull().defaultTo(false))
    .addColumn('blocked_reason', 'text')
    .addColumn('position', 'numeric', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    // Which list a card is in *is* its status; this records when it stopped
    // being open, which no list membership can tell you on its own.
    .addColumn('closed_at', 'timestamptz')
    .addUniqueConstraint('card_key_unique_per_project', ['project_id', 'card_key'])
    .addCheckConstraint(
      'card_type_known',
      sql`type in (${sql.join(CARD_TYPES.map((type) => sql.lit(type)))})`,
    )
    .addCheckConstraint(
      'card_priority_known',
      sql`priority is null or priority in (${sql.join(CARD_PRIORITIES.map((priority) => sql.lit(priority)))})`,
    )
    .addCheckConstraint('card_points_not_negative', sql`points is null or points >= 0`)
    .addCheckConstraint(
      'card_estimate_not_negative',
      sql`estimate_minutes is null or estimate_minutes >= 0`,
    )
    .execute();

  // The board query reads exactly this: one list at a time, in position order,
  // open cards only.
  await sql`
    create index card_in_list_idx on card (list_id, position)
      where closed_at is null
  `.execute(database);

  await sql`
    create index card_by_assignee_idx on card (project_id, assignee_id)
      where closed_at is null
  `.execute(database);

  await sql`
    create index card_by_due_idx on card (project_id, due_on)
      where closed_at is null
  `.execute(database);
}

/**
 * Gives every project that already exists a board and the default lists.
 *
 * Projects were created before boards were, and a project whose board appeared
 * only on the next edit would be a project whose board never appeared.
 */
async function giveExistingProjectsABoard(database: Kysely<unknown>): Promise<void> {
  await sql`
    insert into board (project_id)
    select id from project
  `.execute(database);

  for (const list of DEFAULT_LISTS) {
    await sql`
      insert into list (board_id, name, color, wip_limit, position)
      select
        board.id,
        ${sql.lit(list.name)},
        ${sql.lit(list.color)},
        ${list.wipLimit === null ? sql`null::integer` : sql.lit(list.wipLimit)},
        ${sql.lit(list.position)}
      from board
    `.execute(database);
  }
}
