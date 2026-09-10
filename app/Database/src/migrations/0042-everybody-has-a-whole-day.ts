import { sql, type Kysely } from 'kysely';

/**
 * Everybody gets a whole day back.
 *
 * Capacity was set per project, on the project's settings screen, and that was
 * the wrong place for it: how long somebody works is a fact about them rather
 * than about one of the games they are on, and a studio that changes it has to
 * change it once, not once per project. The screen and the command that fed it
 * have gone, and the setting comes back on a person's own profile.
 *
 * Until it does, nothing can write this column — so any number left in it from
 * the old screen is a number nobody can correct, and a person stuck at four
 * hours would read as overloaded on every timeline for as long as that lasted.
 * Eight is what the column already defaults to and what everybody assumes, so
 * that is where they all start again.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`update project_member set daily_capacity_hours = 8 where daily_capacity_hours <> 8`.execute(
    database,
  );
}

/**
 * Nothing to undo.
 *
 * The hours somebody had before are not written down anywhere else, so a
 * rollback cannot put them back, and inventing a spread nobody chose would be
 * worse than admitting they are gone. The column and its default are untouched.
 */
export function down(): Promise<void> {
  return Promise.resolve();
}
