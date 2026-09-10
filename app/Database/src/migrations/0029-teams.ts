import { sql, type Kysely } from 'kysely';

/**
 * Teams, and who is in them.
 *
 * A team is how a studio says "these people work on that", and it is the thing
 * project access will hang off next. It carries no access of its own yet: this
 * migration is the grouping, and the grants come with the screen that sets them.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('team')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (column) => column.notNull())
    /*
     * Who answers for the team. Null on purpose, and null again if they leave:
     * a team without a lead is a real state, and losing the person should not
     * take the team with them.
     */
    .addColumn('lead_user_id', 'uuid', (column) =>
      column.references('app_user.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  // Two teams called Audio in one studio is two teams nobody can tell apart on
  // a grant. Case-insensitively, because "audio" is the same team.
  await sql`
    create unique index team_name_unique_per_account on team (account_id, lower(name))
  `.execute(database);

  await database.schema
    .createTable('team_member')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('team_id', 'uuid', (column) =>
      column.notNull().references('team.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (column) =>
      column.notNull().references('app_user.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    // Being in a team twice is not being in it more.
    .addUniqueConstraint('team_member_once', ['team_id', 'user_id'])
    .execute();

  // "Which teams is this person in" is asked for every row of the people list.
  await database.schema
    .createIndex('team_member_by_user')
    .on('team_member')
    .column('user_id')
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  for (const tableName of ['team_member', 'team']) {
    await database.schema.dropTable(tableName).ifExists().execute();
  }
}
