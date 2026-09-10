import type { Kysely } from 'kysely';

/**
 * Who last wrote a document.
 *
 * "Last updated 16 Aug" answers when, and the question a studio actually asks
 * of a design document is who: a paragraph that changed under you matters
 * differently depending on whether the art lead wrote it or you did.
 *
 * Nullable, and stays null when the person who wrote it leaves. A document is
 * not deleted because its author was, and a name is worth less than the prose
 * it was attached to.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('project_doc')
    .addColumn('updated_by', 'uuid', (column) =>
      column.references('app_user.id').onDelete('set null'),
    )
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('project_doc').dropColumn('updated_by').execute();
}
