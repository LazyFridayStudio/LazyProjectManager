import { sql, type Kysely } from 'kysely';

/**
 * The permissions a team holds have an order somebody chose.
 *
 * They came out in whatever order the groups themselves were listed, which is
 * alphabetical and says nothing. A studio that gives a team four groups has an
 * opinion about which of them describes the job and which are the exceptions,
 * and no way to write it down.
 *
 * **This is the order they are read in, not a precedence.** What a team may do
 * is settled by the rules, and where two disagree `deny` wins whatever order
 * they are in — see `decide`. Ordering the list changes the sentence a person
 * reads off the screen and nothing about what anybody may do.
 *
 * An integer rewritten on every move rather than a fraction between neighbours,
 * which is what the board does with cards. A board column holds thousands of
 * cards and cannot be renumbered on each drag; a team holds a handful of groups,
 * and four rows written on a drop is cheaper than the arithmetic that avoids
 * writing them.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('team_permission_group')
    .addColumn('position', 'integer', (column) => column.notNull().defaultTo(0))
    .execute();

  /*
   * Backfilled by name, which is the order they were already coming out in.
   *
   * So nobody's screen rearranges itself on the day this lands: the list looks
   * the same until somebody drags something, and then it looks how they left it.
   */
  await sql`
    update team_permission_group as held
    set position = ordered.place
    from (
      select team_permission_group.id,
             row_number() over (
               partition by team_permission_group.team_id
               order by permission_group.name
             ) as place
      from team_permission_group
      join permission_group on permission_group.id = team_permission_group.group_id
    ) as ordered
    where ordered.id = held.id
  `.execute(database);
}

/** The column goes, and the list is alphabetical again. */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('team_permission_group').dropColumn('position').execute();
}
