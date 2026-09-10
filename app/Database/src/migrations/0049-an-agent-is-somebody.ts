import { sql, type Kysely } from 'kysely';

/**
 * An agent is somebody, and it carries a key rather than a password.
 *
 * The point of this is that an AI reaching the install should be a principal in
 * its own right: its own name on the audit trail, its own permission groups,
 * and its own switch to turn off. So it is a row in `app_user` rather than a
 * table of its own — every foreign key that points at a person already points
 * at that table, and an agent that could not be a card's assignee, a comment's
 * author or a line in the trail would be a second kind of citizen that half the
 * product could not talk about.
 *
 * `kind` is what separates them. A person signs in with a password; an agent
 * cannot sign in at all and presents a token instead. Neither can do the
 * other's thing, and the column is what every check reads.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('app_user')
    .addColumn('kind', 'text', (column) => column.notNull().defaultTo('person'))
    .execute();

  await sql`
    alter table app_user
      add constraint app_user_kind_is_known
      check (kind in ('person', 'agent'))
  `.execute(database);

  /*
   * A key an agent presents instead of signing in.
   *
   * Only the hash is kept, for the reason the session table gives: a copy of
   * the database should not be a drawer full of live keys. The secret is shown
   * once, when it is made, and never again — there is nowhere to read it back
   * from, which is the property that makes losing one merely annoying.
   */
  await database.schema
    .createTable('api_token')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (column) =>
      column.notNull().references('app_user.id').onDelete('cascade'),
    )
    /** What it is for, so a list of keys is a list somebody can act on. */
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('token_hash', 'text', (column) => column.notNull().unique())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    /*
     * When it was last used, and null for one nothing has ever presented.
     *
     * The question a person asks of a list of keys is which of them still
     * matter. Written on use rather than counted, because a counter is a write
     * on every request and this is one a day at most.
     */
    .addColumn('last_used_at', 'timestamptz')
    /** Set rather than deleted, so a revoked key stays visible as revoked. */
    .addColumn('revoked_at', 'timestamptz')
    .execute();

  // Every request carrying a key looks it up by hash, and only a live one
  // counts. Partial, because a revoked key is never the answer to that lookup.
  await sql`
    create index api_token_live_idx on api_token (token_hash)
      where revoked_at is null
  `.execute(database);
}

/**
 * The keys go and every agent becomes a person again.
 *
 * Nothing an agent did is lost — its rows in the trail, its comments and its
 * cards are a user's like anybody else's. What goes is the ability to tell it
 * apart from the people, and every key anybody had issued.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('api_token').execute();
  await database.schema.alterTable('app_user').dropColumn('kind').execute();
}
