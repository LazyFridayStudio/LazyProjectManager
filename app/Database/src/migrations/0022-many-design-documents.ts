import { sql, type Kysely } from 'kysely';

/**
 * A project keeps more than one document.
 *
 * One was the right shape for a design document and the wrong shape for a
 * studio: the combat design, the audio bible and the technical brief are
 * separate documents that separate people own, and putting them end to end in
 * one file makes a contents list nobody can find anything in.
 *
 * So the unique constraint on the project goes, and a document gains a name and
 * a place in the row of tabs. Existing rows are named rather than left blank —
 * a tab with nothing on it is a tab nobody can pick out.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('project_doc')
    .addColumn('title', 'text', (column) => column.notNull().defaultTo('Design document'))
    .execute();

  // Midpoint insertion, as everywhere else a person orders things by hand.
  await database.schema
    .alterTable('project_doc')
    .addColumn('position', 'numeric', (column) => column.notNull().defaultTo(1000))
    .execute();

  // Named by the unique index that made it, which is what Postgres calls the
  // constraint behind `unique` on a column.
  await sql`alter table project_doc drop constraint if exists project_doc_project_id_key`.execute(
    database,
  );

  await database.schema
    .createIndex('project_doc_by_project_idx')
    .on('project_doc')
    .columns(['project_id', 'position'])
    .execute();
}

/**
 * Back to one, keeping the first of each project's documents.
 *
 * The others are dropped rather than concatenated: joining several documents
 * into one produces a file nobody wrote and nobody wants, and a rollback should
 * not invent prose.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`
    delete from project_doc
    where id not in (
      select distinct on (project_id) id
      from project_doc
      order by project_id, position, created_at
    )
  `.execute(database);

  await database.schema.dropIndex('project_doc_by_project_idx').ifExists().execute();
  await database.schema.alterTable('project_doc').dropColumn('position').execute();
  await database.schema.alterTable('project_doc').dropColumn('title').execute();

  await sql`alter table project_doc add constraint project_doc_project_id_key unique (project_id)`.execute(
    database,
  );
}
