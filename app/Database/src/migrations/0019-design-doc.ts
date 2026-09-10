import { sql, type Kysely } from 'kysely';

/**
 * The design document, as chapters of sections.
 *
 * Two levels rather than an arbitrary tree. A game design document is read by
 * people who need to find one thing in it, and every studio that has been given
 * unlimited nesting has produced a document nobody can navigate — the design's
 * chapter tabs across the top only work because there is exactly one level
 * above the sections they hold.
 *
 * A section's body is markdown, which is already how a card describes itself
 * and already what the editor in this product edits. The design draws nine
 * kinds of block; markdown is eight of them with one editing model and one
 * renderer, and the ninth — a reference to an asset — is a slice of its own.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('doc_chapter')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('project_id', 'uuid', (column) =>
      column.notNull().references('project.id').onDelete('cascade'),
    )
    .addColumn('title', 'text', (column) => column.notNull())
    // Midpoint insertion, as everywhere else that a person orders things by
    // hand: reordering one row must not rewrite the rows either side of it.
    .addColumn('position', 'numeric', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await database.schema
    .createIndex('doc_chapter_by_project_idx')
    .on('doc_chapter')
    .columns(['project_id', 'position'])
    .execute();

  await database.schema
    .createTable('doc_section')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    // Denormalised from the chapter so the whole document is one statement
    // scoped by project, without a join to find out which project a section is
    // in. A section cannot change project, only chapter.
    .addColumn('project_id', 'uuid', (column) =>
      column.notNull().references('project.id').onDelete('cascade'),
    )
    .addColumn('chapter_id', 'uuid', (column) =>
      column.notNull().references('doc_chapter.id').onDelete('cascade'),
    )
    .addColumn('title', 'text', (column) => column.notNull())
    /** Markdown, as a card's description is. Empty is a section nobody has written yet. */
    .addColumn('body', 'text', (column) => column.notNull().defaultTo(''))
    .addColumn('position', 'numeric', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await database.schema
    .createIndex('doc_section_by_chapter_idx')
    .on('doc_section')
    .columns(['chapter_id', 'position'])
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  for (const table of ['doc_section', 'doc_chapter']) {
    await database.schema.dropTable(table).ifExists().execute();
  }
}
