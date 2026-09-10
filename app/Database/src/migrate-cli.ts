import type { MigrationResult } from 'kysely/migration';

import { rollbackLastMigration, runMigrations } from './migrations/run-migrations.js';

/**
 * `pnpm db:migrate` — applies pending migrations, or rolls the last one back
 * with `pnpm db:migrate -- down`.
 */

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function readConnectionString(): string {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and start the stack.');
  }

  return connectionString;
}

function reportResults(results: readonly MigrationResult[] | undefined): void {
  if (results === undefined || results.length === 0) {
    process.stdout.write('No migrations to apply. Database is up to date.\n');
    return;
  }

  for (const result of results) {
    process.stdout.write(`${result.status}: ${result.migrationName} (${result.direction})\n`);
  }
}

async function main(): Promise<void> {
  const shouldRollBack = process.argv.includes('down');
  const connectionString = readConnectionString();

  const { error, results } = shouldRollBack
    ? await rollbackLastMigration(connectionString)
    : await runMigrations(connectionString);

  // Report the failure before anything else. A migration that errors comes back
  // with no results, and printing "up to date" first said the opposite of what
  // had happened.
  if (error !== undefined) {
    throw error instanceof Error ? error : new Error(describeError(error));
  }

  reportResults(results);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${describeError(error)}\n`);
  process.exitCode = 1;
}
