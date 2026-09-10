import { CamelCasePlugin, Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';

import {
  configureTypeParsers,
  migrationProvider,
  type Database,
  type DatabaseSchema,
} from '../index.js';
import { Migrator } from 'kysely/migration';

/**
 * A schema-isolated database for one Vitest worker.
 *
 * Vitest runs test files across several worker processes at once. Sharing one
 * schema between them means a truncate in one file wipes rows another file is
 * mid-assertion on, which surfaces as a test that only fails when the suite is
 * run in full. Each worker therefore gets its own Postgres schema, migrated
 * once, and truncated between tests.
 */
export interface TestDatabase {
  readonly database: Database;
  readonly schemaName: string;
  /** Empties every table, leaving the schema in place. Call between tests. */
  truncateAllTables(): Promise<void>;
  close(): Promise<void>;
}

const TEST_SCHEMA_PREFIX = 'lpm_test_w';

export interface TestDatabaseOptions {
  /**
   * Defaults to `VITEST_POOL_ID`, which Vitest sets per worker process. Pass a
   * value explicitly only when a test needs two connections that must not see
   * each other's rows.
   */
  readonly workerId?: string;
  readonly connectionString?: string;
}

/**
 * Opens a migrated, isolated database for the current worker.
 *
 * Expects the local stack to be up (`pnpm stack:up`). It fails loudly rather
 * than skipping, because a test suite that quietly passes when the database is
 * missing is worse than one that will not start.
 */
export async function createTestDatabase(options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  const connectionString = options.connectionString ?? readTestConnectionString();
  const schemaName = `${TEST_SCHEMA_PREFIX}${options.workerId ?? process.env.VITEST_POOL_ID ?? '1'}`;

  await recreateSchema(connectionString, schemaName);
  await migrateSchema(connectionString, schemaName);

  const database = openSchemaScopedConnection(connectionString, schemaName);

  // Worked out once per worker, because the shape of the schema does not
  // change between tests and asking Postgres about it every time would cost
  // more than the emptying does.
  const order = await readDeletionOrder(database, schemaName);

  return {
    database,
    schemaName,
    truncateAllTables: () => emptyTables(database, order),
    close: () => database.destroy(),
  };
}

function readTestConnectionString(): string {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === '') {
    throw new Error(
      'DATABASE_URL is not set. Database tests need the local stack: run `pnpm stack:up`.',
    );
  }

  return connectionString;
}

/**
 * A connection pinned to one schema.
 *
 * `search_path` puts the worker's schema first and keeps `public` after it, so
 * migrations create tables in the isolated schema while extensions installed
 * once in `public` — citext, in particular — still resolve.
 */
function openSchemaScopedConnection(connectionString: string, schemaName: string): Database {
  // The same driver configuration the application pool gets, so a test cannot
  // pass against a `date` the running server would read back differently.
  configureTypeParsers();

  const pool = new pg.Pool({
    connectionString,
    max: 4,
    options: `-c search_path=${schemaName},public`,
  });

  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin()],
  });
}

/**
 * Drops and recreates the worker's schema.
 *
 * Recreating rather than reusing means a run cannot inherit a half-applied
 * migration from a previous run that was interrupted part-way.
 */
async function recreateSchema(connectionString: string, schemaName: string): Promise<void> {
  const admin = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: 1 }) }),
  });

  try {
    await sql.raw(`drop schema if exists ${schemaName} cascade`).execute(admin);
    await sql.raw(`create schema ${schemaName}`).execute(admin);
    // Extensions are database-wide. Creating citext here, in public, means each
    // worker's migration finds the type already present.
    await sql`create extension if not exists citext`.execute(admin);
  } finally {
    await admin.destroy();
  }
}

/**
 * Applies the real migrations to the worker's schema.
 *
 * The same migration files production runs, not a hand-written fixture schema:
 * a test suite built on a parallel definition of the tables stops catching the
 * migrations being wrong, which is the main thing it should catch.
 */
async function migrateSchema(connectionString: string, schemaName: string): Promise<void> {
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    options: `-c search_path=${schemaName},public`,
  });
  // No CamelCasePlugin, matching how migrations run in production.
  const migrationDatabase = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });

  try {
    const migrator = new Migrator({
      db: migrationDatabase,
      provider: migrationProvider,
      migrationTableSchema: schemaName,
    });

    const { error } = await migrator.migrateToLatest();

    if (error !== undefined) {
      throw error instanceof Error
        ? error
        : new Error(`Migrating the test schema ${schemaName} failed.`);
    }
  } finally {
    await migrationDatabase.destroy();
  }
}

/**
 * Empties every table, children before parents.
 *
 * `delete` rather than `truncate`, which is what this used to do. Truncate is
 * the right tool for a large table and the wrong one to run two hundred times:
 * it takes an exclusive lock and does file-level work per table, which measured
 * at 165ms a call against 6ms for the same rows deleted. Over a suite that is
 * most of a minute spent emptying tables that hold a dozen rows.
 *
 * One statement, so it is one round trip rather than twenty.
 */
async function emptyTables(database: Database, order: readonly string[]): Promise<void> {
  if (order.length === 0) {
    return;
  }

  await sql.raw(order.map((table) => `delete from "${table}"`).join('; ')).execute(database);
}

/**
 * Every table in the schema, ordered so a row is never deleted before the rows
 * pointing at it.
 *
 * Read from the foreign keys rather than written down. The list that used to
 * live here went stale the moment somebody added a table — every asset and
 * repository table was missing from it, and only survived being emptied
 * because `truncate ... cascade` reached them anyway. `delete` does not
 * cascade, so a hand-kept list would have started leaking rows between tests
 * silently, which is the worst way for a test suite to be wrong.
 *
 * Kysely's own bookkeeping is left alone: emptying it would make the next test
 * believe the schema had never been migrated.
 */
async function readDeletionOrder(
  database: Database,
  schemaName: string,
): Promise<readonly string[]> {
  const tables = await sql<{ name: string }>`
    select table_name as name
    from information_schema.tables
    where table_schema = ${schemaName}
      and table_type = 'BASE TABLE'
      and table_name not like 'kysely_%'
  `.execute(database);

  const references = await sql<{ child: string; parent: string }>`
    select
      child.relname as child,
      parent.relname as parent
    from pg_constraint
      join pg_class as child on child.oid = pg_constraint.conrelid
      join pg_class as parent on parent.oid = pg_constraint.confrelid
      join pg_namespace on pg_namespace.oid = child.relnamespace
    where pg_constraint.contype = 'f'
      and pg_namespace.nspname = ${schemaName}
  `.execute(database);

  return sortChildrenFirst(
    tables.rows.map((row) => row.name),
    references.rows.filter((row) => row.child !== row.parent),
  );
}

/**
 * A topological sort, children first.
 *
 * A table that points at itself — a card linked to another card — is not a
 * cycle for this purpose: the rows go in one statement either way. Any genuine
 * cycle between two tables would leave both at the end, which is no worse than
 * the hand-written order was.
 */
function sortChildrenFirst(
  tables: readonly string[],
  references: readonly { child: string; parent: string }[],
): readonly string[] {
  const parentsOf = new Map<string, Set<string>>(tables.map((table) => [table, new Set()]));

  for (const { child, parent } of references) {
    parentsOf.get(child)?.add(parent);
  }

  const ordered: string[] = [];
  const placed = new Set<string>();

  const place = (table: string, seen: Set<string>): void => {
    if (placed.has(table) || seen.has(table)) {
      return;
    }

    seen.add(table);

    // Anything pointing at this table has to go first, so nothing is left
    // holding a reference to a row that is no longer there.
    for (const other of tables) {
      if (parentsOf.get(other)?.has(table) === true) {
        place(other, seen);
      }
    }

    placed.add(table);
    ordered.push(table);
  };

  for (const table of tables) {
    place(table, new Set());
  }

  return ordered;
}
