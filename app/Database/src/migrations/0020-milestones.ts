import { sql, type Kysely } from 'kysely';

/**
 * The dates a project is held to, and the work that belongs to each.
 *
 * A milestone is a name, a goal, and two dates. Everything else about it is
 * counted from the cards that point at it — a milestone with a stored point
 * total is one that disagrees with its own board by Wednesday.
 *
 * The exception is capacity, which is a decision rather than a count: what the
 * team believed it could take on when the milestone was planned. Keeping it is
 * the only way to say afterwards whether the plan was wrong or the fortnight
 * was, and it is null until somebody decides.
 *
 * Dates are required. A milestone with no end is a wish, and the whole point of
 * the release plan is that each of these lands on a day.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('milestone')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('project_id', 'uuid', (column) =>
      column.notNull().references('project.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (column) => column.notNull())
    /** One sentence the team can hold itself to. Null until somebody writes it. */
    .addColumn('goal', 'text')
    .addColumn('starts_on', 'date', (column) => column.notNull())
    .addColumn('ships_on', 'date', (column) => column.notNull())
    /** Points the team believed it could take on. A decision, not a count. */
    .addColumn('capacity_points', 'integer')
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('milestone_ends_after_it_starts', sql`ships_on >= starts_on`)
    .execute();

  // The release plan reads them in date order, which is the only order a
  // release plan has.
  await database.schema
    .createIndex('milestone_by_project_idx')
    .on('milestone')
    .columns(['project_id', 'starts_on'])
    .execute();

  /*
   * Which milestone a card is for.
   *
   * Null is the normal state and stays normal: most cards are work that has to
   * happen without being promised for a particular date, and forcing every one
   * into a milestone is how a milestone stops meaning anything.
   *
   * `set null` rather than cascade — deleting a milestone unpromises its work
   * rather than deleting it. Nobody has ever wanted the other one.
   */
  await database.schema
    .alterTable('card')
    .addColumn('milestone_id', 'uuid', (column) =>
      column.references('milestone.id').onDelete('set null'),
    )
    .execute();

  await database.schema
    .createIndex('card_by_milestone_idx')
    .on('card')
    .columns(['milestone_id'])
    .where(sql.ref('milestone_id'), 'is not', null)
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropIndex('card_by_milestone_idx').ifExists().execute();
  await database.schema.alterTable('card').dropColumn('milestone_id').execute();
  await database.schema.dropTable('milestone').ifExists().execute();
}
