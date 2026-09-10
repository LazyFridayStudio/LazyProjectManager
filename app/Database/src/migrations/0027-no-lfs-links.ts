import { sql, type Kysely } from 'kysely';

/**
 * The fourth kind of link goes away.
 *
 * `lfs_object` was a row that named a large file a push added, read by fetching
 * every path in the delivery and looking for a pointer inside it. What it put on
 * a card was a filename and a size — nothing that could be opened from here,
 * because the bytes live on an LFS server this application never talks to — and
 * it cost a repository read per path to say it.
 *
 * The rows go with it. They are derived, as every `scm_link` row is: the
 * delivery they were read from is still in `scm_event_raw`, and nothing else
 * points at them. Leaving them would mean a kind on a card that no longer has a
 * name to show, which is a worse outcome than a card that has lost a line
 * saying how big a file was.
 */
const LINK_KINDS = ['commit', 'branch', 'pull_request'] as const;

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`delete from scm_link where kind = 'lfs_object'`.execute(database);

  await replaceKindConstraint(database, LINK_KINDS);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await replaceKindConstraint(database, [...LINK_KINDS, 'lfs_object']);
}

/**
 * Dropped and added rather than altered, because Postgres has no way to change
 * what a check constraint checks.
 */
async function replaceKindConstraint(
  database: Kysely<unknown>,
  kinds: readonly string[],
): Promise<void> {
  await sql`alter table scm_link drop constraint if exists scm_link_kind_known`.execute(database);

  await sql`
    alter table scm_link
      add constraint scm_link_kind_known
      check (kind in (${sql.join(kinds.map((kind) => sql.lit(kind)))}))
  `.execute(database);
}
