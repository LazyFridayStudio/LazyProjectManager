import type { Kysely } from 'kysely';

/**
 * A project gets a mark of its own.
 *
 * Key art is the wide picture on the launcher tile, and it is the wrong shape
 * for the places a project is only named: the sidebar draws a square, and until
 * now it drew the first letter of the name into it. A studio with a logo has
 * one already, so the product should show it rather than invent a monogram.
 *
 * Its own column rather than a crop of the key art. They are different pictures
 * with different jobs — one sells the game and one identifies it at sixteen
 * pixels — and a product that derives the second from the first is a product
 * that shows a corner of a screenshot where the logo should be.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  // Plain uuid, like `key_art_file_id` beside it: files are never deleted out
  // from under a project, and a left join already reads a missing one as none.
  await database.schema.alterTable('project').addColumn('logo_file_id', 'uuid').execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('project').dropColumn('logo_file_id').execute();
}
