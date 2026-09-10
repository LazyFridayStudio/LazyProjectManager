import { sql, type Kysely } from 'kysely';

/**
 * The install remembers who set it up.
 *
 * There was no way to name that person. "An admin remains" stopped the last
 * owner being demoted, which keeps somebody in the chair but says nothing about
 * *who* — a studio could promote a contractor, demote the founder, and the rule
 * would be satisfied the whole way.
 *
 * One account is now permanent: the one setup made. Their role cannot be
 * changed and they cannot be suspended, by anybody including themselves. Every
 * other owner stays as changeable as they were.
 *
 * Nullable, because an install restored from a backup taken before this step
 * has nobody named and should still boot. The backfill below picks the earliest
 * owner, which on every install that exists today is the person setup made.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('install_settings')
    /*
     * `set null` rather than `cascade` or `restrict`.
     *
     * Nothing deletes an `app_user` today — people are suspended, which leaves
     * the row — so this is about a hand on a psql prompt. Losing the name of
     * the owner is recoverable; taking the install's settings row with them is
     * not, and refusing the delete would leave somebody stuck at a foreign key
     * they cannot see.
     */
    .addColumn('owner_user_id', 'uuid', (column) =>
      column.references('app_user.id').onDelete('set null'),
    )
    .execute();

  /*
   * The earliest owner, which is the person setup made.
   *
   * `membership` has no created_at of its own, so this goes by the user's —
   * setup writes the account, the user and the membership in one transaction,
   * so the first owner by user is the first owner by any measure.
   */
  await sql`
    update install_settings set owner_user_id = (
      select membership.user_id
      from membership
      join app_user on app_user.id = membership.user_id
      where membership.role = 'owner'
      order by app_user.created_at asc, app_user.id asc
      limit 1
    )
  `.execute(database);
}

/**
 * The column goes. Who the owner was is not written down anywhere else, so
 * rolling back forgets it — and the backfill above finds them again on the way
 * forward.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('install_settings').dropColumn('owner_user_id').execute();
}
