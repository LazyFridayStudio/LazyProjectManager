import { sql, type Kysely } from 'kysely';

/**
 * How many hours a day a person has for this project.
 *
 * The timeline is a capacity chart before it is a calendar: it asks whether the
 * work with dates on it fits in the days remaining, and it cannot ask that
 * without knowing how big a day is. Eight is the default because it is the one
 * everybody assumes, and it is per project rather than per person because an
 * artist splitting a week between two games has two different answers.
 *
 * Zero is allowed and means it: a build bot is a member with work assigned to
 * it and no capacity at all, and so is somebody on leave for the month.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('project_member')
    // Whole hours. Nobody plans a day to the minute, and a number that invites
    // 7.5 invites an argument about the half hour that no schedule survives.
    .addColumn('daily_capacity_hours', 'smallint', (column) => column.notNull().defaultTo(8))
    .execute();

  await database.schema
    .alterTable('project_member')
    .addCheckConstraint(
      'project_member_capacity_is_a_day',
      sql`daily_capacity_hours between 0 and 24`,
    )
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('project_member')
    .dropConstraint('project_member_capacity_is_a_day')
    .execute();

  await database.schema.alterTable('project_member').dropColumn('daily_capacity_hours').execute();
}
