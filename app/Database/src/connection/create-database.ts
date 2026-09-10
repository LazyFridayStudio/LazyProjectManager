import { CamelCasePlugin, Kysely, PostgresDialect, type Transaction } from 'kysely';
import pg from 'pg';

import type { DatabaseSchema } from '../schema/database-schema.js';
import { configureTypeParsers } from './configure-type-parsers.js';

export type Database = Kysely<DatabaseSchema>;

/**
 * A database handle inside a transaction.
 *
 * Re-exported from here so application code never has to depend on `kysely`
 * directly — `packages/db` owns the query builder, and keeping that true is what
 * lets it be swapped without touching every handler.
 */
export type DatabaseTransaction = Transaction<DatabaseSchema>;

export interface DatabaseConnectionOptions {
  readonly connectionString: string;
  /**
   * Upper bound on concurrent connections. The API and the worker each hold
   * their own pool, so the sum across processes must stay under Postgres's
   * `max_connections`.
   */
  readonly maxConnections?: number;
  /** Milliseconds to wait for a free connection before failing the request. */
  readonly connectionTimeoutMs?: number;
}

const DEFAULT_MAX_CONNECTIONS = 10;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;

/**
 * Opens a typed connection pool.
 *
 * The `CamelCasePlugin` is what lets application code read `createdAt` while the
 * database column stays `created_at`. It rewrites identifiers the query builder
 * produces — identifiers inside a raw `sql` fragment are passed through
 * untouched and must already be snake_case.
 */
export function createDatabase(options: DatabaseConnectionOptions): Database {
  configureTypeParsers();

  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
  });

  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin()],
  });
}

/**
 * Confirms the database is answering, and reports how long it took.
 *
 * The latency is as interesting as the boolean: a Postgres that responds in
 * 400ms is the first sign the board view is about to miss its budget.
 */
export async function measureDatabaseHealth(
  database: Database,
): Promise<{ reachable: boolean; latencyMs: number; detail?: string }> {
  const startedAt = performance.now();

  try {
    await database
      .selectNoFrom((expressionBuilder) => expressionBuilder.lit(1).as('probe'))
      .executeTakeFirstOrThrow();
    return { reachable: true, latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return {
      reachable: false,
      latencyMs: Math.round(performance.now() - startedAt),
      detail: error instanceof Error ? error.message : 'Unknown database error',
    };
  }
}
