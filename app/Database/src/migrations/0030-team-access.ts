import { sql, type Kysely } from 'kysely';

/**
 * What a team can reach.
 *
 * Three pieces. A **portfolio** is a named group of projects, so a grant can
 * say "the flagship titles" rather than naming six of them — and so a studio
 * with a hundred projects can still describe access on one screen. A team's
 * **default level** is what it can do to a project nothing else says anything
 * about. A **grant** is the exception: this portfolio, or this one project, at
 * this level.
 *
 * Default and exceptions rather than a row per team per project, which at ten
 * teams and a hundred projects is a thousand rows to write and read for what is
 * usually one sentence.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await createPortfolios(database);
  await addTeamDefault(database);
  await createGrants(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('team_grant').ifExists().execute();
  await database.schema.alterTable('team').dropColumn('default_level').execute();
  await database.schema.alterTable('project').dropColumn('portfolio_id').execute();
  await database.schema.dropTable('portfolio').ifExists().execute();
}

async function createPortfolios(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('portfolio')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    create unique index portfolio_name_unique_per_account on portfolio (account_id, lower(name))
  `.execute(database);

  /*
   * A project is in at most one portfolio.
   *
   * One rather than many on purpose: a project in three portfolios has three
   * answers to "what can this team reach", and the one that wins is a rule
   * nobody could predict from the screen. Set null on delete, so removing a
   * portfolio leaves its projects where they are rather than taking them.
   */
  await database.schema
    .alterTable('project')
    .addColumn('portfolio_id', 'uuid', (column) =>
      column.references('portfolio.id').onDelete('set null'),
    )
    .execute();

  await database.schema
    .createIndex('project_by_portfolio')
    .on('project')
    .column('portfolio_id')
    .execute();
}

async function addTeamDefault(database: Kysely<unknown>): Promise<void> {
  /*
   * What the team can do to a project nothing else says anything about.
   *
   * `none` by default, because a team that reaches everything the moment it is
   * made is a team nobody would have chosen to make that way.
   */
  await database.schema
    .alterTable('team')
    .addColumn('default_level', 'text', (column) => column.notNull().defaultTo('none'))
    .execute();

  await sql`
    alter table team add constraint team_default_level_known
      check (default_level in ('none', 'read', 'write'))
  `.execute(database);
}

async function createGrants(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('team_grant')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('team_id', 'uuid', (column) =>
      column.notNull().references('team.id').onDelete('cascade'),
    )
    .addColumn('portfolio_id', 'uuid', (column) =>
      column.references('portfolio.id').onDelete('cascade'),
    )
    .addColumn('project_id', 'uuid', (column) =>
      column.references('project.id').onDelete('cascade'),
    )
    .addColumn('level', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  // A grant names one thing. Which of the two it named is what makes it a
  // portfolio grant or a project grant, so there is no third column to disagree
  // with them.
  await sql`
    alter table team_grant add constraint team_grant_names_one_thing
      check (num_nonnulls(portfolio_id, project_id) = 1)
  `.execute(database);

  await sql`
    alter table team_grant add constraint team_grant_level_known
      check (level in ('none', 'read', 'write'))
  `.execute(database);

  // One grant per team per thing: two rows saying different levels about the
  // same project is a question the resolver should never have to answer.
  await sql`
    create unique index team_grant_one_per_portfolio on team_grant (team_id, portfolio_id)
      where portfolio_id is not null
  `.execute(database);

  await sql`
    create unique index team_grant_one_per_project on team_grant (team_id, project_id)
      where project_id is not null
  `.execute(database);
}
