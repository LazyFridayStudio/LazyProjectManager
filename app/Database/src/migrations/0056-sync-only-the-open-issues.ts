import { sql, type Kysely } from 'kysely';

/**
 * Whether a sync brings in a repository's closed history.
 *
 * The sync asks for a hundred issues, `state=all`, newest first — so on a
 * repository with any history that is mostly closed work. This repository is
 * the example: 260 issues raised and a handful still open, which means the
 * hundred is spent on things nobody is going to do anything about, and an open
 * issue older than the last hundred created never arrives at all. Not late:
 * never.
 *
 * On the project rather than on the connection, because it is a thing a studio
 * decides about its board rather than about its credentials — `wip_is_advisory`
 * is the precedent, a project-level boolean that changes how a rule is enforced
 * rather than what is on the screen.
 *
 * **Default false, so connecting a repository behaves as it does today.** The
 * first sync of a repository is where this costs the most: a closed issue lands
 * straight at the finished end so a year of history reads as history, and with
 * this on that history never arrives. That is the point, and it is not what
 * somebody expects unless they asked for it.
 *
 * Not retrospective. Cards already made from closed issues stay where they are,
 * because turning a setting on and watching a board silently shed a hundred
 * cards is worse than the noise it was turned on to stop.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('project')
    .addColumn('sync_open_issues_only', 'boolean', (column) =>
      column.notNull().defaultTo(sql`false`),
    )
    .execute();
}

/**
 * The column goes, and every sync reads the whole issue list again.
 *
 * Nothing is lost. Cards this setting kept off a board were never made, so
 * going back means the next sync makes them — which is the behaviour before it
 * existed.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('project').dropColumn('sync_open_issues_only').execute();
}
