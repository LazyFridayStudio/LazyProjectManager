import { sql, type Kysely } from 'kysely';

/**
 * What a project has actually shipped.
 *
 * A release is a tag, a day, and what changed. Everything a studio wants from
 * this page is one question — what did we last give people, and what is in it —
 * and that question is answered by a row here rather than by asking a build
 * server that may not exist.
 *
 * Entered by hand, which is the design's own answer for a studio with no CI
 * connected: "the Builds page stays available and you add each run and release
 * yourself". A later step can fill these in from GitHub Actions, and it will be
 * writing the same rows.
 *
 * `author` is text rather than a user, because the thing that publishes a
 * release is usually `build-bot` and not somebody with an account here. Naming
 * it honestly costs a join and buys nothing.
 *
 * The notes are markdown, in one field, for the reason the design document is:
 * a changelog is written top to bottom, and the headings people put in it are
 * their own. Storing `Added`/`Changed`/`Fixed` as rows would be this product
 * deciding how a studio writes its release notes.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('project_release')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('project_id', 'uuid', (column) =>
      column.notNull().references('project.id').onDelete('cascade'),
    )
    /** `v0.9.4`. What everybody actually calls the release. */
    .addColumn('tag', 'text', (column) => column.notNull())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('published_on', 'date', (column) => column.notNull())
    /** Usually `build-bot`, which is why this is text and not a user. */
    .addColumn('author', 'text', (column) => column.notNull())
    /** The commit it was cut from. Null for one nobody recorded. */
    .addColumn('commit_sha', 'text')
    /**
     * Not for players yet, and not finished at all.
     *
     * Two flags rather than one state, because they are independent: a draft
     * of a pre-release is a real thing a studio has.
     */
    .addColumn('is_prerelease', 'boolean', (column) => column.notNull().defaultTo(false))
    .addColumn('is_draft', 'boolean', (column) => column.notNull().defaultTo(false))
    /** Markdown. Empty is a release nobody has written notes for yet. */
    .addColumn('notes', 'text', (column) => column.notNull().defaultTo(''))
    /** `release.yml · run #218`, as the design writes it. Null until there is one. */
    .addColumn('run_label', 'text')
    /** Where it lives on GitHub, when it lives anywhere. */
    .addColumn('url', 'text')
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    // One row per tag. A project with two `v0.9.4`s is one where nobody can say
    // which build somebody is running.
    .addUniqueConstraint('project_release_tag_is_one_release', ['project_id', 'tag'])
    .execute();

  // Read newest first, always: the latest release is the headline of the page
  // and everything else on it is history.
  await sql`
    create index project_release_by_project_idx
    on project_release (project_id, published_on desc, created_at desc)
  `.execute(database);

  /**
   * What somebody can download.
   *
   * Size is bytes rather than the `4.2 GB` the design draws, because `4.2 GB`
   * cannot be compared, summed, or sorted, and the screen can always write it
   * back out that way. Null for one nobody measured.
   */
  await database.schema
    .createTable('release_asset')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('release_id', 'uuid', (column) =>
      column.notNull().references('project_release.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('size_bytes', 'bigint')
    .addColumn('download_count', 'integer', (column) => column.notNull().defaultTo(0))
    /** Midpoint insertion, as everywhere a person orders things by hand. */
    .addColumn('position', 'numeric', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await database.schema
    .createIndex('release_asset_by_release_idx')
    .on('release_asset')
    .columns(['release_id', 'position'])
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  // The assets go with the release they belong to; nothing here outlives it.
  await database.schema.dropTable('release_asset').ifExists().execute();
  await database.schema.dropTable('project_release').ifExists().execute();
}
