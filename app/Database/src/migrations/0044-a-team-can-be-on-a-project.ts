import { sql, type Kysely } from 'kysely';

/**
 * A team can be on a project, the way a person can.
 *
 * Reaching a project has had two sources since #144: the role — an owner or a
 * lead sees the slate — and being on the project. Everybody else started at
 * nothing, and nothing wrote the second one. `projects.create` put the person
 * who made it on it, and that was the only row this table's neighbour ever got:
 * a studio could make a person, put them in a team, hand the team every group
 * there is, and they still could not open a single project. A group says *what*
 * somebody may do; being on the project says *where*, and there was no way to
 * say where.
 *
 * So both halves land together, and this is the one that needs a table. A row
 * here is a standing grant: everybody in the team reaches the project, joining
 * the team joins its projects, and leaving takes the reach with it. The
 * alternative was to expand a team into one `project_member` row per person at
 * the moment somebody picked it — smaller, and wrong by the following month,
 * because the person who joined Audio in October is not on the projects Audio
 * works on and nothing on the screen says why.
 *
 * **Reach, and not a shred of permission.** A row is a project and a team. What
 * the people in it may do once they are there is what the groups that team
 * holds say, and a level written here would be a third opinion beside the two
 * that already exist.
 *
 * **This is not the grant that was removed in `0035-no-team-grants`.** That one
 * was a level per team over a *portfolio*, plus a default level covering every
 * project an exception did not mention — a second system with an opinion about
 * what somebody may do, on a screen you had to read before the permissions one
 * made sense. This names one project, says nothing about what may be done to
 * it, and is written on the project's own settings screen beside the people.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */

export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('project_team')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('project_id', 'uuid', (column) =>
      column.notNull().references('project.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (column) =>
      column.notNull().references('team.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    /*
     * A project and a team, and nothing else on the row.
     *
     * No level, no seat, no role. Whether the team is on the project is the
     * whole of what this table says; what its people may do once they are there
     * is what the permission groups the team holds say, and a third answer
     * beside those two is the thing this product has spent four migrations
     * removing.
     *
     * One row per pair, so being put on twice is being on once.
     */
    .addUniqueConstraint('project_team_once', ['project_id', 'team_id'])
    .execute();

  /*
   * The side every read starts from.
   *
   * Reach is asked as "which of these projects does this person get to", so the
   * lookup runs project → team → the people in it. The unique constraint above
   * already indexes that pair; this is for the other direction, which is what
   * a team's own screen would ask.
   */
  await database.schema
    .createIndex('project_team_by_team_idx')
    .on('project_team')
    .columns(['team_id', 'project_id'])
    .execute();
}

/**
 * The table goes, and every team is off every project.
 *
 * Which narrows access rather than widening it: anybody who reached a project
 * only through a team no longer does, and has to be put on it by name. That is
 * the honest direction for a permission change to fail in, and the same one
 * `0035` chose on the way forward.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('project_team').execute();
}
