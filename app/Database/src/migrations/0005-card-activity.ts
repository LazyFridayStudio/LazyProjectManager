import { sql, type Kysely } from 'kysely';

/**
 * What happens on a card once it exists: the work broken down, the conversation,
 * and what it is tied to.
 *
 * Also the two columns that let a list say where work goes next, which the
 * prototype's list form asks for and `0003-board` left out.
 */

const LINK_KINDS = ['blocks', 'blocked_by', 'relates', 'duplicates'] as const;

export async function up(database: Kysely<unknown>): Promise<void> {
  await addListFlow(database);
  await createSubtaskTable(database);
  await createCommentTable(database);
  await createCardLinkTable(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  for (const tableName of ['card_link', 'comment', 'subtask']) {
    await database.schema.dropTable(tableName).ifExists().execute();
  }

  await database.schema.alterTable('list').dropColumn('next_list_id').execute();
  await database.schema.alterTable('list').dropColumn('back_list_id').execute();
}

/**
 * Where a card usually goes from here, and where it goes when sent back.
 *
 * Advice rather than a rule: it is what the board offers as the next step, and
 * nothing stops a card being dragged anywhere else.
 */
async function addListFlow(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('list')
    .addColumn('next_list_id', 'uuid', (column) =>
      column.references('list.id').onDelete('set null'),
    )
    .execute();

  await database.schema
    .alterTable('list')
    .addColumn('back_list_id', 'uuid', (column) =>
      column.references('list.id').onDelete('set null'),
    )
    .execute();
}

async function createSubtaskTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('subtask')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('card_id', 'uuid', (column) =>
      column.notNull().references('card.id').onDelete('cascade'),
    )
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('done', 'boolean', (column) => column.notNull().defaultTo(false))
    .addColumn('position', 'numeric', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`create index subtask_on_card_idx on subtask (card_id, position)`.execute(database);
}

async function createCommentTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('comment')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('card_id', 'uuid', (column) =>
      column.notNull().references('card.id').onDelete('cascade'),
    )
    // Kept when the person is removed: a conversation with holes in it is worse
    // than one that says somebody has left.
    .addColumn('author_id', 'uuid', (column) =>
      column.references('app_user.id').onDelete('set null'),
    )
    .addColumn('body', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('edited_at', 'timestamptz')
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await sql`
    create index comment_on_card_idx on comment (card_id, created_at)
      where deleted_at is null
  `.execute(database);
}

async function createCardLinkTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('card_link')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('from_card_id', 'uuid', (column) =>
      column.notNull().references('card.id').onDelete('cascade'),
    )
    .addColumn('to_card_id', 'uuid', (column) =>
      column.notNull().references('card.id').onDelete('cascade'),
    )
    .addColumn('kind', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    // The same pair, the same way round, is one link however many times it is
    // asked for.
    .addUniqueConstraint('card_link_unique', ['from_card_id', 'to_card_id', 'kind'])
    // A card that blocks itself is a deadlock nobody can undo from the screen.
    .addCheckConstraint('card_link_not_to_itself', sql`from_card_id <> to_card_id`)
    .addCheckConstraint(
      'card_link_kind_known',
      sql`kind in (${sql.join(LINK_KINDS.map((kind) => sql.lit(kind)))})`,
    )
    .execute();

  await sql`create index card_link_from_idx on card_link (from_card_id)`.execute(database);
  await sql`create index card_link_to_idx on card_link (to_card_id)`.execute(database);
}
