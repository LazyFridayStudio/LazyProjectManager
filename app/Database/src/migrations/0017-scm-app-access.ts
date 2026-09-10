import { sql, type Kysely } from 'kysely';

/**
 * Credentials for reading the repository, not just hearing from it.
 *
 * A webhook is one-way: the forge tells us a push happened and names the paths
 * that changed, and that is enough for commits, branches and pull requests. It
 * is not enough for LFS, where what matters is inside the file — a pointer is a
 * three-line text file naming an object and its size, and nothing in a webhook
 * payload contains it.
 *
 * So a connection can also hold a GitHub App: an app id, the installation on
 * the repository, and a private key. The key signs a short-lived assertion,
 * which is exchanged for an installation token, which reads the file. All three
 * are null on a connection that only listens, which is every connection made
 * before this and every one a studio chooses to leave that way.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('scm_connection')
    // Numeric at the forge, text here: it is an identifier rather than a
    // quantity, and nothing about it is ever added up.
    .addColumn('app_id', 'text')
    .execute();

  await database.schema.alterTable('scm_connection').addColumn('installation_id', 'text').execute();

  // Encrypted at rest, like the webhook secret beside it: signing needs the key
  // itself, so a hash would be no use.
  await database.schema.alterTable('scm_connection').addColumn('private_key_enc', 'text').execute();

  /** When the credentials were last known to work, which is what a screen reports. */
  await database.schema
    .alterTable('scm_connection')
    .addColumn('access_checked_at', 'timestamptz')
    .execute();

  // All three together or none: an app id with no key is a connection that
  // cannot sign anything, and a key with no installation has nothing to sign
  // for. The database refuses the half-configured state rather than every
  // reader having to guess which half it has.
  await sql`
    alter table scm_connection
      add constraint scm_connection_app_complete
      check (num_nonnulls(app_id, installation_id, private_key_enc) in (0, 3))
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`
    alter table scm_connection drop constraint if exists scm_connection_app_complete
  `.execute(database);

  for (const column of ['app_id', 'installation_id', 'private_key_enc', 'access_checked_at']) {
    await database.schema.alterTable('scm_connection').dropColumn(column).execute();
  }
}
