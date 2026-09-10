import { sql, type Kysely } from 'kysely';

/**
 * An asset gets the checklist a card has had since `0005-card-activity`.
 *
 * `asset.status` says how far along the whole thing is — concept, wip, review,
 * approved, final — and that is all it has ever been able to say. A character
 * sitting at `wip` might have a finished mesh and no textures, or the reverse,
 * and nothing on the screen could tell those two apart. The stages inside the
 * work are the part an art lead actually schedules around.
 *
 * Its own table rather than a nullable pair of owners on `subtask`. Generalising
 * that one is the tidier end state and it is not worth the risk here: the card
 * path is the most-used screen in the product, and the whole benefit of sharing
 * the table is one set of handlers, which is a smaller saving than a
 * forward-only migration over live rows on the board is a hazard. If a third
 * kind of thing ever wants stages, that is the moment to unify the three rather
 * than to have guessed here.
 *
 * Freeform, with no seeded rows and no template: Mesh, UV, Texture and
 * Animation are what a character happens to need, and a prop, a sound and a
 * cinematic each want a different list. A pipeline that came with the category
 * would be a fourth opinion about how a studio works, and this product does not
 * hold one.
 *
 * Cascades, and is not in the recycle bin. An asset archives rather than
 * deletes, so there is no asset delete for the bin to catch; the cascade is for
 * a project being removed underneath it, which takes the assets and everything
 * hanging off them together.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('asset_subtask')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('asset_id', 'uuid', (column) =>
      column.notNull().references('asset.id').onDelete('cascade'),
    )
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('done', 'boolean', (column) => column.notNull().defaultTo(false))
    .addColumn('position', 'numeric', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  // The order they are read in is the order they are drawn in, and the library
  // counts them per asset, so both go through this.
  await sql`create index asset_subtask_on_asset_idx on asset_subtask (asset_id, position)`.execute(
    database,
  );
}

/**
 * The stages go, and the assets keep the status they always had.
 *
 * Nothing else held them, so a rollback really does lose what anybody typed —
 * which is the same bargain `0005-card-activity` makes for a card's.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('asset_subtask').ifExists().execute();
}
