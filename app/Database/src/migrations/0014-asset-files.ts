import { sql, type Kysely } from 'kysely';

/**
 * The working files of an asset: the source, not the picture of it.
 *
 * `asset_reference` holds what the thing looks like. This holds what it is made
 * of — the `.blend`, the `.psd`, the Substance graph, the FBX handed to
 * engineering.
 *
 * Either the bytes are here or they are somewhere else. A studio with a
 * Perforce depot or a NAS is not going to upload a four-gigabyte source file
 * into this, and a tool that only accepts uploads would be a tool that has an
 * out-of-date copy of everything. So a row carries a `file_id` or a `url`, and
 * exactly one of them.
 *
 * One table rather than two, because to the person reading an asset these are
 * one list — "the files" — in one order. Two tables would mean two queries and
 * nothing to interleave them by. The check constraint is what keeps a nullable
 * pair honest: there is no row where both are set and none where neither is.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('asset_file')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('asset_id', 'uuid', (column) =>
      column.notNull().references('asset.id').onDelete('cascade'),
    )
    /** Set when the bytes are here. */
    .addColumn('file_id', 'uuid', (column) => column.references('file.id').onDelete('cascade'))
    /** Set when they are somewhere else, and this is where. */
    .addColumn('url', 'text')
    /** What to call it in the list. The filename, for something uploaded. */
    .addColumn('label', 'text', (column) => column.notNull())
    .addColumn('position', 'numeric(20, 10)', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  // The whole reason one table is safe. Without it this is a pair of nullable
  // columns that every query has to guess at.
  await sql`
    alter table asset_file
      add constraint asset_file_one_source check (num_nonnulls(file_id, url) = 1)
  `.execute(database);

  await sql`create index asset_file_asset_idx on asset_file (asset_id, position)`.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('asset_file').ifExists().execute();
}
