import type { Kysely } from 'kysely';

/**
 * Where a file's thumbnail lives, when it has one.
 *
 * A derivative rather than a second `file` row: it has no filename anybody
 * chose, nothing links to it directly, and it is deleted with the original
 * rather than on its own. A row would invite all three of those to drift.
 *
 * Null means one has not been made — either because the worker has not got to
 * it, or because nothing here can decode the format. The two are deliberately
 * indistinguishable to anything that reads it: both mean "draw the filename".
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('file').addColumn('thumbnail_key', 'text').execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('file').dropColumn('thumbnail_key').execute();
}
