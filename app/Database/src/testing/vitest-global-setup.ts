import pg from 'pg';

const TEST_SCHEMA_PATTERN = 'lpm_test_w%';

/**
 * Creates, once and before any worker starts, what every worker's schema needs
 * from the database as a whole.
 *
 * Extensions are database-wide, and each worker used to create citext for itself
 * as it recreated its schema. `create extension if not exists` is not safe when
 * two connections run it at the same moment: both find no extension, both insert
 * one, and the second fails on `pg_extension_name_index`. A developer's database
 * already has citext, so it never happened there. Every CI run starts from an
 * empty Postgres, which is where it did — and where the release workflow runs
 * the same suite before it publishes anything.
 *
 * Created here, the workers find it already present and theirs is a no-op.
 *
 * Uses `pg` directly for the same reason `teardown` does.
 */
export async function setup(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === '') {
    return;
  }

  const client = new pg.Client({ connectionString });

  try {
    await client.connect();
    await client.query('create extension if not exists citext');
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Drops the per-worker schemas the suite created.
 *
 * Not just tidiness. Kysely's migrator decides whether it needs to create its
 * bookkeeping tables by introspecting what already exists, and it does not
 * restrict that to the schema it is about to write in. A leftover
 * `kysely_migration` table in `lpm_test_w3` convinces a later plain
 * `runMigrations` that setup is done, so it skips creating
 * `kysely_migration_lock` in `public` and then fails looking for it.
 *
 * That is not hypothetical: it broke the CI step that applies migrations after
 * the tests, against a database whose `public` schema was completely empty.
 *
 * Uses `pg` directly rather than Kysely because Vitest loads this file with the
 * repository root as its resolution base, where the workspace packages'
 * dependencies are not visible.
 */
export async function teardown(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === '') {
    return;
  }

  const client = new pg.Client({ connectionString });

  try {
    await client.connect();

    const schemas = await client.query<{ nspname: string }>(
      'select nspname from pg_namespace where nspname like $1',
      [TEST_SCHEMA_PATTERN],
    );

    for (const { nspname } of schemas.rows) {
      // Identifiers cannot be parameterised, and these names come from
      // pg_namespace filtered by our own prefix rather than from any input.
      await client.query(`drop schema if exists "${nspname}" cascade`);
    }
  } catch {
    // A teardown that throws turns a green suite red for a reason nobody can
    // act on. The next run recreates these schemas anyway.
  } finally {
    await client.end().catch(() => undefined);
  }
}
