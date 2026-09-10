import { sql, type Kysely } from 'kysely';

/**
 * Time somebody actually worked, against the card or the asset they worked on.
 *
 * The estimate is what a card was expected to take. This is what it took, and
 * they are different numbers that a producer needs both of — the whole reason
 * `projects.budget` says it deals in estimates rather than spend is that until
 * now there was nothing else to deal in.
 *
 * Minutes, like an estimate, because every question anybody asks of these is
 * addition: a card's total, a person's week. `2d 4h` is how somebody says it and
 * `duration.ts` is where that is read, on both sides of the wire.
 *
 * One table for both, rather than `card_work` and `asset_work`. An entry is the
 * same shape whichever it hangs off, and a studio that wanted "how long did the
 * watchtower take" across the asset and the cards about it would otherwise be
 * asked to add up two tables that had already drifted apart.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('work_log')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('card_id', 'uuid', (column) => column.references('card.id').onDelete('cascade'))
    .addColumn('asset_id', 'uuid', (column) => column.references('asset.id').onDelete('cascade'))
    /*
     * Whose hours these were, and null once they have left.
     *
     * The same choice the comment table makes: the work happened, and a row
     * that vanished with the person would take a fortnight off the project's
     * history to tidy up one name.
     */
    .addColumn('user_id', 'uuid', (column) => column.references('app_user.id').onDelete('set null'))
    .addColumn('minutes', 'integer', (column) => column.notNull())
    /*
     * The day the work was done, which is not the day it was typed in.
     *
     * Nobody logs as they go. Friday afternoon gets written up on Monday, and a
     * sheet that recorded Monday would be wrong about the only thing it is for.
     */
    .addColumn('worked_on', 'date', (column) => column.notNull())
    .addColumn('note', 'text')
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  // Exactly one thing was worked on. Neither is an entry about nothing; both is
  // an entry that would be counted twice by anything totalling either.
  await sql`
    alter table work_log
      add constraint work_log_is_about_one_thing
      check (num_nonnulls(card_id, asset_id) = 1)
  `.execute(database);

  // A positive number of minutes. Zero says nothing and a negative one is an
  // edit somebody meant to make by deleting the entry.
  await sql`
    alter table work_log
      add constraint work_log_is_time_spent
      check (minutes > 0)
  `.execute(database);

  /*
   * The two questions this table is asked, and they are asked by the panel that
   * is already open: what has been logged against this card, newest first.
   */
  await sql`
    create index work_log_on_card_idx on work_log (card_id, worked_on desc, created_at desc)
      where card_id is not null
  `.execute(database);

  await sql`
    create index work_log_on_asset_idx on work_log (asset_id, worked_on desc, created_at desc)
      where asset_id is not null
  `.execute(database);
}

/**
 * The table goes, and every hour anybody recorded goes with it.
 *
 * Nothing else knows these numbers — an estimate is a different column and is
 * untouched — so this is the one migration in the set whose `down` throws away
 * something a person typed and cannot reconstruct.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('work_log').execute();
}
