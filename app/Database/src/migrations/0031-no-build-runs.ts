import type { Kysely } from 'kysely';

import { up as createBuildRuns } from './0026-build-runs.js';

/**
 * The Builds page keeps releases and stops keeping runs.
 *
 * A run was only ever typed in. The GitHub App reads releases, not workflow
 * runs, so the fourteen-field form was the sole way a row ever appeared —
 * meaning the page asked a studio to hand-copy its CI in order to look at it.
 * Nobody does that twice, and a build history that is only as current as the
 * last time somebody typed is worse than no build history, because it is read
 * as current.
 *
 * What the project shipped is a different question, and it is the one this page
 * is for. `project_release` and `release_asset` stay.
 *
 * Should runs come back, they come back synced: the rows would be written by a
 * reader of `workflow_run`, not by a form, and the shape they want is that
 * endpoint's rather than this one's.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  // Children first: the foreign keys cascade, but dropping in this order says
  // what depends on what without relying on that.
  await database.schema.dropTable('build_artifact').ifExists().execute();
  await database.schema.dropTable('build_step').ifExists().execute();
  await database.schema.dropTable('build_run').ifExists().execute();
}

/**
 * The tables come back exactly as the step that made them made them.
 *
 * By calling that step rather than by repeating its DDL: two copies of three
 * table definitions is two things to keep in step, and migrations are
 * append-only so the one being called cannot move.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await createBuildRuns(database);
}
