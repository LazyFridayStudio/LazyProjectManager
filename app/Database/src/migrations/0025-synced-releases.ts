import { sql, type Kysely } from 'kysely';

/**
 * Where a release came from.
 *
 * Everything on the Builds page was typed by hand until now. Once a repository
 * can fill it in, the two have to be told apart — because they are protected
 * differently: prose somebody wrote is never overwritten by a sync, and a row
 * the forge owns is refreshed from it every time.
 *
 * `hand` for the ones already there. Nobody typed those under a forge's name,
 * and defaulting them to one would hand a sync permission to rewrite them.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('project_release')
    .addColumn('source', 'text', (column) => column.notNull().defaultTo('hand'))
    .execute();

  /**
   * The forge's own id for the release.
   *
   * Matched on rather than the tag, because a tag can be renamed upstream and
   * matching on it would leave the old row behind as a second release nobody
   * shipped. Null for anything entered by hand, which has no forge to have an
   * id from.
   */
  await database.schema.alterTable('project_release').addColumn('external_id', 'text').execute();

  // One row per thing the forge has. Partial, so the hand-entered rows — which
  // all have no external id — are not competing for a single null slot.
  await sql`
    create unique index project_release_by_source_idx
    on project_release (project_id, source, external_id)
    where external_id is not null
  `.execute(database);

  /**
   * When releases were last read from the repository.
   *
   * On the connection rather than the project: it is a fact about the link to
   * the forge, and it is null until somebody has actually pulled once — which
   * is how the page tells "never synced" from "synced and there was nothing".
   */
  await database.schema
    .alterTable('scm_connection')
    .addColumn('releases_synced_at', 'timestamptz')
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('scm_connection').dropColumn('releases_synced_at').execute();
  await sql`drop index if exists project_release_by_source_idx`.execute(database);
  await database.schema.alterTable('project_release').dropColumn('external_id').execute();
  await database.schema.alterTable('project_release').dropColumn('source').execute();
}
