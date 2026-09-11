import { sql, type Kysely } from 'kysely';

/**
 * Two categories may share a name for a moment inside a command, as long as
 * they do not by the end of it.
 *
 * Deleting a category brings what was inside it up to where it sat. A `Props`
 * inside `Props` is a sub-category arriving at the level its parent is leaving —
 * and the parent cannot leave first, because its children point at it until
 * they have moved and the bin copies it after. So for the length of the delete
 * there are two `Props` side by side, and an index that checked every row as it
 * was written turned a delete whose outcome was fine into a raw database error.
 *
 * Putting it back from the bin is the same thing in reverse: the parent returns
 * to a level its own child is standing in, and only stops clashing once the
 * child has been moved back inside it.
 *
 * A constraint rather than an index, because only a constraint can be deferred.
 * `initially immediate`, so every other write is checked exactly as it was — a
 * create or a rename still hears about a clash from the statement that caused
 * it — and only a command that asks for the wait gets one. Under the same name,
 * so the handlers that recognise a clash by it still do.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`drop index asset_category_name_unique_among_siblings`.execute(database);

  await sql`
    alter table asset_category
      add constraint asset_category_name_unique_among_siblings
      unique nulls not distinct (project_id, parent_id, name)
      deferrable initially immediate
  `.execute(database);
}

/** Back to an index, which checks every row as it is written. */
export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`
    alter table asset_category
      drop constraint asset_category_name_unique_among_siblings
  `.execute(database);

  await sql`
    create unique index asset_category_name_unique_among_siblings
      on asset_category (project_id, parent_id, name)
      nulls not distinct
  `.execute(database);
}
