import { Kysely, PostgresDialect } from 'kysely';
import { Migrator, type MigrationResultSet } from 'kysely/migration';
import pg from 'pg';

import { migrationProvider } from './index.js';

/**
 * Applies every pending migration.
 *
 * Migrations run on their own untyped connection with no `CamelCasePlugin`, so
 * the identifiers written in a migration file are exactly the identifiers that
 * reach Postgres. Forward-only: there is no `down` path in production, and the
 * `down` functions exist for local iteration and tests.
 */
export async function runMigrations(connectionString: string): Promise<MigrationResultSet> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const database = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });

  try {
    const migrator = new Migrator({ db: database, provider: migrationProvider });
    return await migrator.migrateToLatest();
  } finally {
    await database.destroy();
  }
}

/** Rolls back the most recent migration. Local development and tests only. */
export async function rollbackLastMigration(connectionString: string): Promise<MigrationResultSet> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const database = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });

  try {
    const migrator = new Migrator({ db: database, provider: migrationProvider });
    return await migrator.migrateDown();
  } finally {
    await database.destroy();
  }
}
