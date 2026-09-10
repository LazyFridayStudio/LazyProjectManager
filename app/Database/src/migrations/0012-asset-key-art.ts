import { type Kysely } from 'kysely';

/**
 * The picture of an asset.
 *
 * A library is read by looking at it. Until now a tile showed the words
 * "concept" where the render belongs, which is a caption standing in for the
 * thing it captions.
 *
 * The same shape a project's key art takes, and the same reasoning: one image per
 * asset, pointing at a row in `file` rather than holding bytes, and `set null` on
 * delete because losing the picture is not losing the asset.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('asset')
    .addColumn('key_art_file_id', 'uuid', (column) =>
      column.references('file.id').onDelete('set null'),
    )
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('asset').dropColumn('key_art_file_id').execute();
}
