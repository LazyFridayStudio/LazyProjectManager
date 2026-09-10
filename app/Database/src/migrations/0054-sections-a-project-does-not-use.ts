import { sql, type Kysely } from 'kysely';

/**
 * The sections a project has switched off.
 *
 * Every project got all eight, so a project with no schedule to keep carried
 * Timeline for its whole life, next to Builds for the builds it never cut and
 * Budget for the money nobody was tracking. Everyone on it learned to skip
 * three doors into empty rooms, and an empty screen reads as a thing somebody
 * forgot to fill in rather than a thing this project does not do.
 *
 * One column rather than a boolean per section, which would be six columns now
 * and a migration every time a section is added. The names are already shared
 * vocabulary — `projectSectionSchema` — so the column holds those words and the
 * command validates them; nothing here has to know what a section is.
 *
 * Written whole rather than appended to, which is what makes an array safe here
 * where `asset_tag` needed a table: six switches are saved from one form as one
 * set, so there is no read-append-write for two people to lose each other in.
 *
 * Empty by default, so every project that exists today keeps all eight and a
 * project made tomorrow behaves as one made yesterday.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('project')
    .addColumn('disabled_sections', 'jsonb', (column) =>
      column.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .execute();
}

/**
 * The column goes, and every project has all eight sections again.
 *
 * Nothing else is lost. Turning a section off never deleted anything — the
 * cards, builds, budget rows and documents stayed where they were — so this
 * puts back the doors and leaves the rooms untouched.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('project').dropColumn('disabled_sections').execute();
}
