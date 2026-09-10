import { sql, type Kysely } from 'kysely';

/**
 * Where a deleted thing waits before it is really gone.
 *
 * A bin rather than a `deleted_at` column on every table it could happen to.
 * Twelve tables would have meant twelve columns and a `where deleted_at is
 * null` on every query that reads them — including the ones written next year
 * by somebody who does not know the rule. A missed filter there shows a deleted
 * thing to somebody as though it were still real, which is the worse failure.
 *
 * Here, a deleted thing is genuinely deleted. Nothing in the app changes. What
 * is kept is a copy: the rows themselves, and the small repairs the delete made
 * to rows that survived it.
 *
 * `rows` is every row the delete removed, per table, in the order they have to
 * go back — parents before children, because the foreign keys are still real.
 *
 * `repairs` is what the delete did to things it did not delete: the assets that
 * were moved to `Unorganised` because their category went, the cards whose
 * milestone was set to null. Each records what the column was and what the
 * delete left it as, so restoring can put it back **only if nobody has changed
 * it since**. Undoing a delete should not undo a decision somebody made after.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('deleted_thing')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    /** `team`, `milestone`, `projectDoc` — which recipe puts it back. */
    .addColumn('kind', 'text', (column) => column.notNull())
    /** The id it had. Kept so the trail and the bin can be read side by side. */
    .addColumn('subject_id', 'uuid', (column) => column.notNull())
    /**
     * What it was called, copied at the moment it went.
     *
     * Read off the payload instead would mean knowing the shape of seven kinds
     * of thing to draw one list, and the name is the only part of a bin row
     * anybody reads.
     */
    .addColumn('name', 'text', (column) => column.notNull())
    /** The line under the name: "4 people", "in Saltmarsh". */
    .addColumn('about', 'text')
    /**
     * Cascaded, because a project that is really gone takes its bin with it.
     *
     * Null for the things that belong to the install rather than to a project —
     * a team, a permission group, a portfolio.
     */
    .addColumn('project_id', 'uuid', (column) =>
      column.references('project.id').onDelete('cascade'),
    )
    .addColumn('rows', 'jsonb', (column) => column.notNull())
    .addColumn('repairs', 'jsonb', (column) => column.notNull().defaultTo(sql`'[]'::jsonb`))
    /** Null once they have left. The deletion still happened. */
    .addColumn('deleted_by', 'uuid', (column) =>
      column.references('app_user.id').onDelete('set null'),
    )
    .addColumn('deleted_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    /**
     * Written down rather than worked out from `deleted_at` on the way past.
     *
     * How long a studio keeps things is a setting waiting to happen, and a row
     * that carries its own date can be given a different one without every
     * older row silently changing when the default does.
     */
    .addColumn('purge_after', 'timestamptz', (column) => column.notNull())
    .execute();

  // The list: an account's bin, newest first.
  await sql`
    create index deleted_thing_newest on deleted_thing (account_id, deleted_at desc)
  `.execute(database);

  // The sweep: what is past its date, across every account at once.
  await sql`
    create index deleted_thing_due on deleted_thing (purge_after)
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('deleted_thing').ifExists().execute();
}
