import { sql, type Kysely } from 'kysely';

/**
 * The design document becomes one document.
 *
 * It was chapters of sections, which is a filing cabinet: to write a paragraph
 * somebody had to first decide which drawer it went in, and to read the thing
 * end to end they clicked through nine of them. A design document is written
 * the way a document is written — top to bottom, in one field — and its
 * structure comes from the headings in the prose rather than from rows in a
 * table.
 *
 * The headings still navigate it. They are read out of the markdown as it is
 * rendered, which is what stops a contents list from ever pointing at a heading
 * that has been rewritten.
 *
 * The old rows are dropped rather than folded into the new column. Nothing has
 * shipped, so the only documents in existence are the demo seed's — which the
 * seed writes again — and there is no reason to carry a translation nobody will
 * ever run against real prose.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  for (const table of ['doc_section', 'doc_chapter']) {
    await database.schema.dropTable(table).ifExists().execute();
  }

  await database.schema
    .createTable('project_doc')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    // One per project, said by the database rather than by whoever writes the
    // next query against it.
    .addColumn('project_id', 'uuid', (column) =>
      column.notNull().unique().references('project.id').onDelete('cascade'),
    )
    .addColumn('body', 'text', (column) => column.notNull().defaultTo(''))
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('project_doc').ifExists().execute();

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
    .addColumn('project_id', 'uuid', (column) =>
      column.notNull().references('project.id').onDelete('cascade'),
    )
    .addColumn('chapter_id', 'uuid', (column) =>
      column.notNull().references('doc_chapter.id').onDelete('cascade'),
    )
    .addColumn('title', 'text', (column) => column.notNull())
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
