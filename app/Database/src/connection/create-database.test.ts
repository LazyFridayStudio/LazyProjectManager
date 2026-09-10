import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase, measureDatabaseHealth, type Database } from './create-database.js';

const REACHABLE_URL = process.env.DATABASE_URL ?? 'postgres://lpm:lpm@localhost:5432/lpm';
/** Port 1 is reserved and nothing listens there, so connecting fails fast. */
const UNREACHABLE_URL = 'postgres://lpm:lpm@127.0.0.1:1/lpm';

describe('GIVEN a database connection', () => {
  let opened: Database | undefined;

  afterEach(async () => {
    await opened?.destroy();
    opened = undefined;
  });

  describe('WHEN it is opened against a running Postgres', () => {
    // Deliberately no query against an application table: this file tests how a
    // connection behaves, and depending on the schema being migrated would make
    // it fail for a reason that has nothing to do with connecting.
    it('THEN its health probe reports it reachable, with a latency', async () => {
      opened = createDatabase({ connectionString: REACHABLE_URL });

      const health = await measureDatabaseHealth(opened);

      expect(health.reachable).toBe(true);
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.detail).toBeUndefined();
    });

    it('THEN the connection limits can be tuned', async () => {
      opened = createDatabase({
        connectionString: REACHABLE_URL,
        maxConnections: 2,
        connectionTimeoutMs: 2_000,
      });

      await expect(measureDatabaseHealth(opened)).resolves.toMatchObject({ reachable: true });
    });
  });

  describe('WHEN it is opened against an address nothing is listening on', () => {
    it('THEN the health probe reports it unreachable rather than throwing', async () => {
      opened = createDatabase({
        connectionString: UNREACHABLE_URL,
        connectionTimeoutMs: 1_000,
      });

      const health = await measureDatabaseHealth(opened);

      // The connect screen has to be able to say "up but unhealthy". A thrown
      // error here would surface as "no server at this address".
      expect(health.reachable).toBe(false);
      expect(health.detail).toEqual(expect.any(String));
    });
  });
});
