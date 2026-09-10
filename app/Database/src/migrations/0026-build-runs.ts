import { sql, type Kysely } from 'kysely';

/**
 * Every time the project was built, and how it went.
 *
 * The other half of the Builds page. A release answers "what did we ship"; this
 * answers the question a studio asks far more often — is the build green, and
 * if not, since when.
 *
 * `source` and `external_id` on the same terms as a release: what somebody
 * typed is never overwritten by a sync, and what a forge owns is refreshed from
 * it. A studio with no CI records the runs it cares about by hand, which is the
 * design's own answer for one.
 *
 * A run is one job on one platform rather than a whole workflow. That is what
 * the design lists and what a person means by "the win64 build failed" — a
 * workflow that packaged two platforms and half failed is two rows, because it
 * is two answers.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await createRuns(database);
  await createSteps(database);
  await createArtifacts(database);
}

async function createRuns(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('build_run')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('project_id', 'uuid', (column) =>
      column.notNull().references('project.id').onDelete('cascade'),
    )
    .addColumn('source', 'text', (column) => column.notNull().defaultTo('hand'))
    .addColumn('external_id', 'text')
    /** `#2418`. What a person says out loud when they name a build. */
    .addColumn('run_number', 'text', (column) => column.notNull())
    /** `release.yml`. Null for a studio that has no workflow files at all. */
    .addColumn('workflow', 'text')
    /** What set it off: `push`, `pull_request`, `release`, `workflow_dispatch`. */
    .addColumn('event', 'text', (column) => column.notNull())
    /** `package-win64` — the job inside the workflow, which is what failed. */
    .addColumn('job', 'text')
    /** `win64`, `ps5 devkit`. A studio's own word for where it ran. */
    .addColumn('platform', 'text')
    /** `success`, `failure`, `cancelled`, or `running` for one still going. */
    .addColumn('conclusion', 'text', (column) => column.notNull())
    .addColumn('head_branch', 'text')
    .addColumn('head_sha', 'text')
    /** The release tag this run was cut for, when it was cut for one. */
    .addColumn('tag', 'text')
    /** Who or what started it. Usually `build-bot`, so text rather than a user. */
    .addColumn('actor', 'text')
    /** The commit message, which is what tells somebody what broke. */
    .addColumn('message', 'text')
    .addColumn('started_at', 'timestamptz', (column) => column.notNull())
    /** Null for one still running, which has no length yet. */
    .addColumn('duration_seconds', 'integer')
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  // Newest first, always: the question is what happened recently.
  await sql`
    create index build_run_by_project_idx
    on build_run (project_id, started_at desc, created_at desc)
  `.execute(database);

  // One row per thing the forge has, on the same terms as a release.
  await sql`
    create unique index build_run_by_source_idx
    on build_run (project_id, source, external_id)
    where external_id is not null
  `.execute(database);
}

/**
 * The steps of one run.
 *
 * Which step failed is the whole of what somebody opens a failed build to find
 * out, and it is the one thing a run's own row cannot say.
 */
async function createSteps(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('build_step')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('build_run_id', 'uuid', (column) =>
      column.notNull().references('build_run.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('conclusion', 'text', (column) => column.notNull())
    .addColumn('duration_seconds', 'integer')
    /** The order they ran in, which is the only order they mean anything in. */
    .addColumn('position', 'numeric', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await database.schema
    .createIndex('build_step_by_run_idx')
    .on('build_step')
    .columns(['build_run_id', 'position'])
    .execute();
}

/**
 * What a run produced.
 *
 * Separate from a release's downloads: an artifact is a build somebody on the
 * team pulls to test, and it expires. A release asset is what went out to people
 * and does not.
 */
async function createArtifacts(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('build_artifact')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('build_run_id', 'uuid', (column) =>
      column.notNull().references('build_run.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('size_bytes', 'bigint')
    /** The day it stops being downloadable. Null for one that does not expire. */
    .addColumn('expires_on', 'date')
    .addColumn('position', 'numeric', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await database.schema
    .createIndex('build_artifact_by_run_idx')
    .on('build_artifact')
    .columns(['build_run_id', 'position'])
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  // The steps and artifacts go with the run they belong to; nothing here
  // outlives it.
  await database.schema.dropTable('build_artifact').ifExists().execute();
  await database.schema.dropTable('build_step').ifExists().execute();
  await database.schema.dropTable('build_run').ifExists().execute();
}
