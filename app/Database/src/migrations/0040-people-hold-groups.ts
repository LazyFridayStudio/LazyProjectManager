import { sql, type Kysely } from 'kysely';

/**
 * A permission group can be given to a person, not only to a team.
 *
 * Teams have held groups since #152, and it works: a group says what somebody
 * may do, and holding it is how they come to may. What had no such answer was a
 * person. The Users screen offered a role instead — one of five rungs, each
 * standing for a bundle of permissions nobody could see — which is the second
 * system this product has had an opinion about the same question with, and the
 * one the permissions work has been unpicking all along.
 *
 * The same shape as `team_permission_group` deliberately. Rules reach a person
 * through their teams or directly, both are a row saying "this group, this
 * holder", and `deny` still wins wherever two of them disagree.
 *
 * Nothing is migrated into it. A role is still the floor an action falls back
 * to when no group speaks, so an install that has not touched this behaves on
 * the day it lands exactly as it did the day before — which is the property
 * worth having while the rest of the roles work is still being decided.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('user_permission_group')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (column) =>
      column.notNull().references('app_user.id').onDelete('cascade'),
    )
    .addColumn('group_id', 'uuid', (column) =>
      column.notNull().references('permission_group.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    // Holding a group twice is holding it once. The screen is a switch, and a
    // switch pressed twice by two people should not be an error either time.
    .addUniqueConstraint('user_permission_group_unique', ['user_id', 'group_id'])
    .execute();

  // Every request resolves a session, and a session gathers the rules reaching
  // the person it belongs to. This is the side that lookup starts from.
  await sql`
    create index user_permission_group_by_user_idx on user_permission_group (user_id)
  `.execute(database);
}

/**
 * The table goes, and with it every group given to a person directly.
 *
 * Which loses no access on the way back: a group held by a person only ever
 * widened what their role already allowed, so a rolled-back install is one
 * where the role is deciding again — the state it was in before this ran.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('user_permission_group').execute();
}
