import { sql, type Kysely } from 'kysely';

/**
 * Which theme a person reads the app in.
 *
 * On the person rather than in their browser, which is the difference between
 * a preference and a habit of one machine: somebody who picks the light theme
 * on the studio workstation should not be handed the dark one on the laptop.
 * The sidebar's collapsed state is the other choice and it stays in
 * `localStorage`, because it is about the window rather than about them.
 *
 * A text column with a default rather than a `user_preference` table. There is
 * one preference; a table for it would be a join on `identity.me`, which is the
 * query every screen waits for before it draws anything.
 *
 * Dark by default, because that is what every existing install is looking at
 * and a migration should not change what anybody sees.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('app_user')
    .addColumn('theme', 'text', (column) => column.notNull().defaultTo('dark'))
    .execute();

  // The set is small and closed, and a typo in it is a person whose app never
  // draws. A check constraint rather than an enum type: adding a third theme
  // should be one migration rather than one plus an `alter type`.
  await sql`
    alter table app_user
      add constraint app_user_theme_is_known
      check (theme in ('dark', 'light'))
  `.execute(database);
}

/** The column goes, and everybody is back on the dark theme. */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('app_user').dropColumn('theme').execute();
}
