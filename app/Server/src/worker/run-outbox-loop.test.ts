import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestDatabase, type TestDatabase } from '@lpm/database/testing';
import type { Database } from '@lpm/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runOutboxLoop, type OutboxLoop } from './run-outbox-loop.js';

/**
 * What the worker does when a pass goes wrong.
 *
 * The question nobody could ask before: the loop lived in `worker.ts`, which
 * starts a worker on import, so no test could reach it. Its answer was "stop
 * for ever, and stay running" — which is how a fresh install came up with an
 * outbox nothing drained and a container that called it a successful boot.
 *
 * Against a real database, because what is worth surviving here is a database
 * failing, and a mock would agree with whatever this file assumed.
 */

let testDatabase: TestDatabase;
let heartbeatFile: string;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
});

afterAll(async () => {
  await testDatabase.close();
});

/**
 * A database that refuses every statement.
 *
 * What a migration landing a moment late looks like from inside the loop, and
 * what a database restarting looks like an hour later.
 */
function refusesEverything(real: Database): Database {
  return new Proxy(real, {
    get(target, property, receiver) {
      if (property === 'selectFrom') {
        return () => {
          throw new Error('relation "scm_event_raw" does not exist');
        };
      }

      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

function loopFor(overrides: Partial<OutboxLoop> & { readonly signal: AbortSignal }): OutboxLoop {
  return {
    database: testDatabase.database,
    consumers: [],
    pollIntervalMs: 1,
    errorPauseMs: 1,
    heartbeatFile,
    appSecret: undefined,
    ...overrides,
  };
}

describe('GIVEN a worker going round its loop', () => {
  beforeEach(async () => {
    await testDatabase.truncateAllTables();
    // Its own file per test: one of these asserts there is no heartbeat at all,
    // which a file another test had touched would quietly disprove.
    heartbeatFile = join(await mkdtemp(join(tmpdir(), 'lpm-worker-')), 'heartbeat');
  });

  describe('WHEN a pass throws', () => {
    it('THEN it goes round again rather than stopping at the first one', async () => {
      const stopping = new AbortController();
      let failures = 0;

      await runOutboxLoop(
        loopFor({
          database: refusesEverything(testDatabase.database),
          signal: stopping.signal,
          onPassError: () => {
            failures += 1;

            if (failures === 3) stopping.abort();
          },
        }),
      );

      // Three, not one. Before this the throw left `runOutboxLoop` altogether
      // and the worker never came round again.
      expect(failures).toBe(3);
    });

    it('THEN a worker that never once got round writes no heartbeat at all', async () => {
      const stopping = new AbortController();
      let failures = 0;

      await runOutboxLoop(
        loopFor({
          database: refusesEverything(testDatabase.database),
          signal: stopping.signal,
          onPassError: () => {
            failures += 1;

            if (failures === 3) stopping.abort();
          },
        }),
      );

      // The healthcheck cannot stat a file that is not there, so a boot that
      // never worked is reported as one. It used to write the heartbeat on the
      // way in and then throw, which let `--wait` call it a healthy start.
      await expect(stat(heartbeatFile)).rejects.toThrow();
    });
  });

  describe('WHEN the passes are getting through', () => {
    it('THEN the heartbeat keeps being touched, and it stops when asked', async () => {
      const stopping = new AbortController();
      const startedAt = Date.now();

      setTimeout(() => {
        stopping.abort();
      }, 150);

      await runOutboxLoop(loopFor({ signal: stopping.signal }));

      // Returned rather than run on: a shutdown lands between passes, so the
      // worker is never cut off part-way through a drain.
      expect(Date.now() - startedAt).toBeLessThan(10_000);
      expect((await stat(heartbeatFile)).mtimeMs).toBeGreaterThanOrEqual(startedAt);
    });
  });
});
