import { sql, type Kysely } from 'kysely';

/**
 * A team no longer says which projects its people reach.
 *
 * `team_grant` and `team.default_level` answered *where* somebody worked. A
 * permission group answers *what* they may do. Holding both meant two systems
 * with an opinion about one question, on two screens, and the Teams one had to
 * be understood before the Permissions one made sense.
 *
 * Reaching a project is now the role and being on the project — an owner or a
 * lead sees the slate, everybody else sees what they were added to. A team is a
 * grouping of people and a holder of permission groups, which is all anybody
 * used it for once the groups existed.
 *
 * `portfolio` stays. Its only consumer used to be a grant covering a group of
 * projects at once, but a project also carries `portfolio_id` as filing and the
 * launcher reads it — so it survives as a label rather than as access.
 *
 * **This narrows access rather than widening it.** Anybody who reached a project
 * only through a team grant now does not, and has to be added to the project.
 * That is the honest direction for a permission change to fail in.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('team_grant').ifExists().execute();
  await database.schema.alterTable('team').dropColumn('default_level').execute();
}

/**
 * The column and the table come back, empty.
 *
 * Written out rather than by calling 0030, which also makes `portfolio` and
 * `project.portfolio_id` — those never went away, and clearing the ground for
 * that step to run again would delete filing that is still being used. A
 * rollback that destroys live data to restore a shape is not a rollback.
 *
 * What was in them does not come back either. A grant is a sentence somebody
 * wrote — "this team, this portfolio, read" — and nothing is left holding those
 * sentences. Rolling back gives the shape and every team at its default of
 * `none`.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('team')
    .addColumn('default_level', 'text', (column) => column.notNull().defaultTo('none'))
    .execute();

  await sql`
    alter table team add constraint team_default_level_known
      check (default_level in ('none', 'read', 'write'))
  `.execute(database);

  await database.schema
    .createTable('team_grant')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('team_id', 'uuid', (column) =>
      column.notNull().references('team.id').onDelete('cascade'),
    )
    .addColumn('portfolio_id', 'uuid', (column) =>
      column.references('portfolio.id').onDelete('cascade'),
    )
    .addColumn('project_id', 'uuid', (column) =>
      column.references('project.id').onDelete('cascade'),
    )
    .addColumn('level', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    alter table team_grant add constraint team_grant_names_one_thing
      check (num_nonnulls(portfolio_id, project_id) = 1)
  `.execute(database);

  await sql`
    alter table team_grant add constraint team_grant_level_known
      check (level in ('none', 'read', 'write'))
  `.execute(database);

  await sql`
    create unique index team_grant_one_per_portfolio on team_grant (team_id, portfolio_id)
      where portfolio_id is not null
  `.execute(database);

  await sql`
    create unique index team_grant_one_per_project on team_grant (team_id, project_id)
      where project_id is not null
  `.execute(database);
}
