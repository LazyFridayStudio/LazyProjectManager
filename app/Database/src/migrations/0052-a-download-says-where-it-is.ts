import type { Kysely } from 'kysely';

/**
 * A download learns where it is.
 *
 * The builds page listed a release's files by name and size and had nowhere to
 * send anybody who wanted one — the arrow beside each row was decoration on a
 * count, and the page's only real link was to the release on the forge. So the
 * one thing a build page exists for, handing somebody the build, was the thing
 * it could not do.
 *
 * Nullable, and not backfilled. A forge tells us where its files are and a sync
 * fills these in on its next pass; a release somebody typed has whatever they
 * typed, which may be nothing. Null means "no link known", which the row draws
 * as no button rather than as a button that fails.
 *
 * Text rather than a stricter type: this is a URL somebody else minted, and the
 * useful check is that it parses and is `http`, which the command schema does
 * where the failure can be reported to the person typing it.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('release_asset').addColumn('download_url', 'text').execute();
}

/**
 * The column goes, and with it every link a sync had found.
 *
 * Nothing else is lost: the name, the size and the count are what the row was
 * before this, and they are untouched. A sync puts the links back.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('release_asset').dropColumn('download_url').execute();
}
