import { sql, type Kysely } from 'kysely';

/**
 * Which cards are about which assets.
 *
 * `DOMAIN_MODEL.md` sketches this as two nullable columns on `card_link` — one
 * pointing at a card, one at an asset, with exactly one of them set. This is a
 * table of its own instead, because a nullable pair is a table where every query
 * has to remember which half it is looking at, and where one unique constraint
 * would have to mean two different things.
 *
 * There is no `kind`. A card relates to another card in several ways — it
 * blocks, is blocked by, duplicates — but there is only one thing a card can be
 * to an asset: about it.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('card_asset_link')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('card_id', 'uuid', (column) =>
      column.notNull().references('card.id').onDelete('cascade'),
    )
    .addColumn('asset_id', 'uuid', (column) =>
      column.notNull().references('asset.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    // The same pair is one link however many times it is asked for.
    .addUniqueConstraint('card_asset_link_unique', ['card_id', 'asset_id'])
    .execute();

  // Both directions are read: a card shows its assets, and an asset shows the
  // work outstanding on it — which is the half that makes a library worth
  // keeping.
  await sql`create index card_asset_link_card_idx on card_asset_link (card_id)`.execute(database);
  await sql`create index card_asset_link_asset_idx on card_asset_link (asset_id)`.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('card_asset_link').ifExists().execute();
}
