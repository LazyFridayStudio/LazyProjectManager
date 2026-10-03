import { sql, type Kysely } from 'kysely';

/**
 * Which assets belong with which other assets.
 *
 * A boss and what it drops, a set and its pieces: things filed under different
 * categories, because a helm is a helmet and a sword is a weapon, that still
 * go together. A category cannot say it without breaking the filing, and a tag
 * says it on neither asset's panel.
 *
 * Its own table rather than a second meaning for `card_asset_link`, because a
 * card to an asset and an asset to an asset are different pairs, and one table
 * holding both would be one where every query had to remember which half it
 * was looking at.
 *
 * One row per pair, stored the same way round whichever end asked: the lower
 * id first. So the unique constraint holds the pair rather than one direction
 * of it, and the check that orders them is also what stops an asset being
 * linked to itself. Card links store a row each way, because `blocks` reads
 * differently from the other end; this link reads the same from both.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('asset_link')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('first_asset_id', 'uuid', (column) =>
      column.notNull().references('asset.id').onDelete('cascade'),
    )
    .addColumn('second_asset_id', 'uuid', (column) =>
      column.notNull().references('asset.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('asset_link_unique', ['first_asset_id', 'second_asset_id'])
    .addCheckConstraint('asset_link_ordered', sql`first_asset_id < second_asset_id`)
    .execute();

  // The unique constraint already finds a pair by its first asset. An asset's
  // panel asks from either end, so the second needs its own.
  await sql`create index asset_link_second_idx on asset_link (second_asset_id)`.execute(database);

  /*
   * Linking assets is its own permission, `asset.link`, and every group already
   * says what it thinks of it: whatever it says about changing an asset.
   *
   * Without this, a group written before today says nothing about the new
   * action, and saying nothing falls back to the role — which for an agent is
   * no action at all. An agent given "Files and assets" so it could fill a
   * library in would be refused the one thing this was built for it to do.
   *
   * `on conflict do nothing`, as the split into one action per rule did: a
   * group that already speaks about it said the more specific thing.
   */
  await sql`
    insert into permission_rule (account_id, group_id, action, effect)
    select rule.account_id, rule.group_id, 'asset.link', rule.effect
    from permission_rule as rule
    where rule.action = 'asset.update'
    on conflict (group_id, action) do nothing
  `.execute(database);
}

/**
 * The links go, and so do the rules about them.
 *
 * A rule naming an action this build does not know is one nothing checks, which
 * is a permission that silently does nothing.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`delete from permission_rule where action = 'asset.link'`.execute(database);
  await database.schema.dropTable('asset_link').ifExists().execute();
}
