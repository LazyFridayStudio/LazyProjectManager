import { sql, type Kysely } from 'kysely';

/**
 * Portfolios go.
 *
 * A portfolio was a named group of projects, and it existed for one reason: a
 * team could be granted one, so a studio with a hundred projects could say
 * "the flagship titles" once instead of a hundred times. That grant went in
 * #144 — a permission group says *what* somebody may do and project membership
 * says *where* — and nothing took its place as a reader.
 *
 * What was left was filing. A label on a project, a panel under the people, and
 * a dropdown on project settings, none of which decided anything. A concept
 * that costs a table, a column, three commands, a query and a screen, and buys
 * a label, is a concept to remove rather than to keep explaining.
 *
 * If a studio wants to group projects again later, that is a thing to design on
 * its own merits — not the shape left behind by a permission model that has
 * already been replaced.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('project').dropColumn('portfolio_id').execute();
  await database.schema.dropTable('portfolio').execute();

  /*
   * And whatever is waiting in the bin under that name.
   *
   * A bin row holds a copy of the rows it would put back, and the table those
   * rows go into no longer exists. The recovery screen already hides a kind it
   * has no recipe for, so leaving them would only mean rows nothing can read
   * and nothing can purge.
   */
  await sql`delete from deleted_thing where kind = 'portfolio'`.execute(database);
}

/**
 * The table and the column come back empty.
 *
 * Which is the honest half of a rollback: the shape can be restored, and what
 * was filed under it cannot — that was deleted with the table on the way
 * forward, and a rollback that invented a filing nobody chose would be worse
 * than one that admits the filing is gone.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('portfolio')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    create unique index portfolio_name_unique_per_account on portfolio (account_id, lower(name))
  `.execute(database);

  await database.schema
    .alterTable('project')
    .addColumn('portfolio_id', 'uuid', (column) =>
      column.references('portfolio.id').onDelete('set null'),
    )
    .execute();
}
