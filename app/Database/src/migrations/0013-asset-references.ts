import { sql, type Kysely } from 'kysely';

/**
 * The pictures of an asset — all of them.
 *
 * `0012` gave an asset one image, the way a project has one piece of key art.
 * That was the wrong shape: an asset is a thing being made, and what it
 * accumulates is a silhouette, colour keys, a material study, a scale reference
 * and a render — a sheet of them, not a portrait. Replacing the picture was the
 * only thing that model allowed, which is not something anybody wants to do.
 *
 * The first by position is the one a tile shows. The rest are the sheet.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('asset_reference')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('asset_id', 'uuid', (column) =>
      column.notNull().references('asset.id').onDelete('cascade'),
    )
    .addColumn('file_id', 'uuid', (column) =>
      column.notNull().references('file.id').onDelete('cascade'),
    )
    /** Numeric, as everywhere: a reference can be dropped between two others. */
    .addColumn('position', 'numeric(20, 10)', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    // The same file twice on one asset is one reference.
    .addUniqueConstraint('asset_reference_unique', ['asset_id', 'file_id'])
    .execute();

  await sql`
    create index asset_reference_asset_idx on asset_reference (asset_id, position)
  `.execute(database);

  // Whatever `0012` collected becomes the first reference, rather than being
  // dropped on the floor of an upgrade.
  await sql`
    insert into asset_reference (account_id, asset_id, file_id, position)
    select asset.account_id, asset.id, asset.key_art_file_id, 1000
    from asset
    where asset.key_art_file_id is not null
  `.execute(database);

  await database.schema.alterTable('asset').dropColumn('key_art_file_id').execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('asset')
    .addColumn('key_art_file_id', 'uuid', (column) =>
      column.references('file.id').onDelete('set null'),
    )
    .execute();

  // The first reference goes back to being the one picture; the rest cannot be
  // carried by a column that holds one.
  await sql`
    update asset
    set key_art_file_id = first_reference.file_id
    from (
      select distinct on (asset_id) asset_id, file_id
      from asset_reference
      order by asset_id, position
    ) as first_reference
    where first_reference.asset_id = asset.id
  `.execute(database);

  await database.schema.dropTable('asset_reference').ifExists().execute();
}
