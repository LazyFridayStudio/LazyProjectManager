import { sql, type Kysely } from 'kysely';

/**
 * A theme somebody wrote, rather than one of the two that shipped.
 *
 * Appearance offered two swatches and that was the whole of the choice. Every
 * colour, size, radius and shadow is already a constant in `tokens/`, rendered
 * into one stylesheet — there has been exactly one place the palette is written
 * for some time. What there was not is a way for a person to write into it.
 *
 * Two changes, and the first is the one migration 0048 said would come: its
 * check constraint was written as a constraint rather than an enum type
 * precisely so a third theme would be an `alter`, and this is that alter.
 *
 * The second is where the colours live. **A `jsonb` column on `app_user` rather
 * than a `user_theme` table**: this is deliberately a personal setting — their
 * own local theme — and one person keeps one. A table is what lets somebody
 * keep several and name them, which is a different feature; and because the
 * palette is data either way, handing it to somebody else stays a matter of
 * copying the JSON rather than of a schema that has to be rebuilt for it.
 *
 * A handful of colours rather than ninety. Almost every custom property is
 * derived — the text tones are percentages of the text colour, the prose
 * headings are three steps of the accent ramp — so what is stored is the small
 * set at the root of that, and everything else follows at runtime.
 *
 * Null for everybody, which is what every person is until they build one. A
 * theme of `custom` with no colours falls back to dark, so a half-written row
 * cannot leave anybody staring at nothing.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('app_user').addColumn('theme_colors', 'jsonb').execute();

  await sql`
    alter table app_user drop constraint app_user_theme_is_known
  `.execute(database);

  await sql`
    alter table app_user
      add constraint app_user_theme_is_known
      check (theme in ('dark', 'light', 'custom'))
  `.execute(database);
}

/**
 * Back to two themes, and anybody on a third goes to dark.
 *
 * The colours go with the column. Moving those people to dark first is what
 * makes the constraint addable again — a row saying `custom` would refuse it —
 * and dark is where everybody was before any of this.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`update app_user set theme = 'dark' where theme = 'custom'`.execute(database);

  await sql`
    alter table app_user drop constraint app_user_theme_is_known
  `.execute(database);

  await sql`
    alter table app_user
      add constraint app_user_theme_is_known
      check (theme in ('dark', 'light'))
  `.execute(database);

  await database.schema.alterTable('app_user').dropColumn('theme_colors').execute();
}
