import { sql, type Kysely } from 'kysely';

/**
 * The words a studio files its own assets under.
 *
 * A category says what kind of thing something is and there is exactly one. A
 * tag says anything else anybody wants to be able to find later — `modular`,
 * `act-1`, `outsourced`, `cloth-sim` — and there are as many as are useful.
 *
 * A table rather than a `text[]` on `asset`. An array reads well and writes
 * badly: adding a tag means reading the array, appending and writing it back,
 * so two people tagging the same asset at once lose one of the two. An insert
 * cannot do that. It also makes "every tag used in this project" an ordinary
 * query rather than an `unnest`, which is what a filter panel is built on.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('asset_tag')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('asset_id', 'uuid', (column) =>
      column.notNull().references('asset.id').onDelete('cascade'),
    )
    /** Already lowercase and hyphenated by the time it arrives. */
    .addColumn('tag', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    // The same tag twice on one asset is one tag, however many times somebody
    // presses the button.
    .addUniqueConstraint('asset_tag_unique', ['asset_id', 'tag'])
    .execute();

  // Both directions are read: an asset shows its tags, and a project has to be
  // able to list the tags anybody has used in it to offer them as a filter.
  await sql`create index asset_tag_asset_idx on asset_tag (asset_id)`.execute(database);
  await sql`create index asset_tag_lookup_idx on asset_tag (account_id, tag)`.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('asset_tag').ifExists().execute();
}
