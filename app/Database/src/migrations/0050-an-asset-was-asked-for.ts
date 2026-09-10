import type { Kysely } from 'kysely';

/**
 * An asset gets somebody who asked for it, the way a card has all along.
 *
 * A library already says who is making a thing. It has never said who wanted
 * it, and that is the name somebody needs when the brief turns out to be thin:
 * an art lead holding a prop with no reference sheet has to ask a person, and
 * "whoever filed it" is not a person until it is written down.
 *
 * Nullable, and not backfilled. Nothing recorded who created an asset before
 * this, so there is no honest answer for the ones already in a library — and
 * guessing at the project's owner would put a name on a row that nobody typed.
 * Unknown says what is true; it is the same thing a card's reporter says when
 * the account behind it has since been removed.
 *
 * `set null` rather than a cascade, for exactly that reason: somebody leaving
 * the studio is not a reason to delete the thing they asked for.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('asset')
    .addColumn('reporter_id', 'uuid', (column) =>
      column.references('app_user.id').onDelete('set null'),
    )
    .execute();
}

/**
 * The column goes, and with it every name anybody had put against an asset.
 *
 * Nothing else is lost: who is making a thing is `assignee_id` and is untouched.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('asset').dropColumn('reporter_id').execute();
}
