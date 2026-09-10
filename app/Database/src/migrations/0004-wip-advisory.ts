import type { Kysely } from 'kysely';

/**
 * Whether a project's work-in-progress limits say no or only say so.
 *
 * A limit that only warns is a number nobody reads, so the default is that it
 * refuses. This is the deliberate way out, for a team who set a limit
 * optimistically and would otherwise work around the tool rather than with it.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('project')
    .addColumn('wip_is_advisory', 'boolean', (column) => column.notNull().defaultTo(false))
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('project').dropColumn('wip_is_advisory').execute();
}
