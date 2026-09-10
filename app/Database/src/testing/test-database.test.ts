import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from './test-database.js';
import { seedInstall } from './seed-install.js';

describe('GIVEN a test database opened for a worker', () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.close();
  });

  describe('WHEN it is created', () => {
    it('THEN it is isolated in a schema named for the worker', () => {
      expect(testDatabase.schemaName).toMatch(/^lpm_test_w/);
    });

    it('THEN the real migrations have been applied to that schema', async () => {
      // CamelCasePlugin rewrites result column names as well as identifiers in
      // queries, so `table_name` arrives as `tableName`.
      const tables = await sql<{ tableName: string }>`
        select table_name from information_schema.tables
        where table_schema = ${testDatabase.schemaName}
        order by table_name
      `.execute(testDatabase.database);

      expect(tables.rows.map((row) => row.tableName)).toEqual(
        expect.arrayContaining(['account', 'app_user', 'command_log', 'domain_event', 'session']),
      );
    });
  });

  describe('WHEN rows have been seeded and the tables are truncated', () => {
    it('THEN the rows are gone', async () => {
      await seedInstall(testDatabase.database);
      await testDatabase.truncateAllTables();

      const users = await testDatabase.database.selectFrom('appUser').selectAll().execute();
      expect(users).toHaveLength(0);
    });

    it('THEN the migration bookkeeping survives, so the schema stays migrated', async () => {
      await testDatabase.truncateAllTables();

      const applied = await sql<{ count: string }>`
        select count(*)::text as count from kysely_migration
      `.execute(testDatabase.database);

      expect(Number(applied.rows[0]?.count ?? 0)).toBeGreaterThan(0);
    });
  });
});
