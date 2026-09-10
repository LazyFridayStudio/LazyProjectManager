import { sql, type Kysely } from 'kysely';

/**
 * A comment can name somebody, and they are told.
 *
 * The name is already in the comment body — `@[Mira Kaur](user:018f…)`, written
 * by the picker so the id is decided at the one moment anybody knows who was
 * meant. So this table is not where a mention is recorded; it is where an
 * *unread* one is.
 *
 * Kept apart from the body for two reasons. Reading it means asking "what is
 * waiting for me", which is a question about a person and not about a card — no
 * query wants to scan every comment on the install to answer it. And a mention
 * has a state the sentence does not: it has been seen, or it has not.
 *
 * Written by the server from the body it just stored, never from anything the
 * client claims. A browser that posted a comment naming nobody and a mention
 * naming everybody would otherwise be a way to make the whole studio's marks
 * light up.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('comment_mention')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('comment_id', 'uuid', (column) =>
      column.notNull().references('comment.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (column) =>
      column.notNull().references('app_user.id').onDelete('cascade'),
    )
    /*
     * When they dealt with it, or null while it is still waiting.
     *
     * A timestamp rather than a flag: "three unread" is the same query either
     * way, and only one of them can answer how long something sat there.
     */
    .addColumn('seen_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    // Naming somebody twice in one sentence is naming them once.
    .addUniqueConstraint('comment_mention_once', ['comment_id', 'user_id'])
    .execute();

  /*
   * The only question this table is ever asked.
   *
   * "What is waiting for me" — so the index is the person, and it holds only
   * the rows that are still waiting. A studio that has been running a year has
   * a great many mentions and a handful of unread ones, and a partial index is
   * the difference between those two numbers.
   */
  await sql`
    create index comment_mention_waiting_idx on comment_mention (user_id, created_at desc)
      where seen_at is null
  `.execute(database);
}

/**
 * The table goes, and with it every mark anybody had waiting.
 *
 * Nothing said is lost: the mention itself is a run of text inside the comment,
 * and that is untouched. What goes is the knowledge of which ones had not been
 * read yet, which is a fortnight's worth of small red circles and nothing more.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('comment_mention').execute();
}
