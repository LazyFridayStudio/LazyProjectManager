import { sql, type Kysely } from 'kysely';

/**
 * An issue whose card was deleted here does not come back on the next sync.
 *
 * The board matches an issue to a card by `external_id`, and an issue with no
 * card is an issue that needs one — which is exactly what a deleted card looks
 * like from the sync's side. So deleting a duplicate that came off a repository
 * would have lasted until the worker next came round, and the card would be
 * back within the half hour with nobody having done anything wrong.
 *
 * A row here is the board's standing answer about one issue: *we do not want a
 * card for this*. The forge is told nothing. Deleting a card is a statement
 * about this board, and closing somebody's issue because a card went would be
 * this deciding what a repository says.
 *
 * It outlives the bin deliberately. A week is how long somebody has to change
 * their mind about the delete; this has to still be true in a fortnight, so it
 * cannot be kept in the row that gets purged. Putting the card back leaves the
 * row here, which costs nothing: the sync finds the card by its external id and
 * never reaches the question this answers.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('dismissed_issue')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('project_id', 'uuid', (column) =>
      column.notNull().references('project.id').onDelete('cascade'),
    )
    // The forge's own id for the issue, which is what `card.external_id` holds.
    // Its number is not enough: a number is only unique within a repository, and
    // a project can be pointed at a different one.
    .addColumn('external_id', 'text', (column) => column.notNull())
    .addColumn('dismissed_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    // One answer per issue, which is also the index the sync reads it by.
    // Deleting a card, restoring it and deleting it again says the same thing
    // twice rather than something new.
    .addUniqueConstraint('dismissed_issue_unique', ['project_id', 'external_id'])
    .execute();
}

/**
 * The table goes, and with it the board's memory of which issues it turned down.
 *
 * Which is the honest outcome rather than a loss: a build without this table is
 * a build whose sync would put those cards back anyway, so keeping the rows
 * would only leave a promise nothing was left to honour.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('dismissed_issue').execute();
}
