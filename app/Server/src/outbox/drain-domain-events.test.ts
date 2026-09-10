import { createSortableId } from '@lpm/database';
import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { drainDomainEvents, type DomainEventRecord } from './drain-domain-events.js';

describe('GIVEN unprocessed events sitting in the outbox', () => {
  let testDatabase: TestDatabase;
  let accountId: string;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.close();
  });

  beforeEach(async () => {
    await testDatabase.truncateAllTables();
    const install = await seedInstall(testDatabase.database);
    accountId = install.accountId;
  });

  async function appendEvent(name: string): Promise<void> {
    await testDatabase.database
      .insertInto('domainEvent')
      .values({
        id: createSortableId(),
        accountId,
        aggregateType: 'test',
        aggregateId: accountId,
        name,
        payload: JSON.stringify({ name }),
        actorId: null,
      })
      .execute();
  }

  describe('WHEN the outbox is drained with a consumer', () => {
    it('THEN every event is handed to the consumer', async () => {
      await appendEvent('test.first');
      await appendEvent('test.second');
      const seen: string[] = [];

      const handled = await drainDomainEvents({
        database: testDatabase.database,
        consumers: [
          {
            name: 'recorder',
            handle: (event: DomainEventRecord) => {
              seen.push(event.name);
              return Promise.resolve();
            },
          },
        ],
      });

      expect(handled).toBe(2);
      expect(seen).toEqual(['test.first', 'test.second']);
    });

    it('THEN the events are marked processed so they are not replayed', async () => {
      await appendEvent('test.first');

      await drainDomainEvents({ database: testDatabase.database, consumers: [] });

      const unprocessed = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .where('processedAt', 'is', null)
        .execute();

      expect(unprocessed).toHaveLength(0);
    });

    it('THEN a second drain finds nothing left to do', async () => {
      await appendEvent('test.first');
      await drainDomainEvents({ database: testDatabase.database, consumers: [] });

      const handled = await drainDomainEvents({ database: testDatabase.database, consumers: [] });

      expect(handled).toBe(0);
    });

    it('THEN the consumer receives the payload it was given', async () => {
      await appendEvent('test.first');
      const payloads: Record<string, unknown>[] = [];

      await drainDomainEvents({
        database: testDatabase.database,
        consumers: [
          {
            name: 'recorder',
            handle: (event) => {
              payloads.push(event.payload);
              return Promise.resolve();
            },
          },
        ],
      });

      expect(payloads).toEqual([{ name: 'test.first' }]);
    });
  });

  describe('WHEN the outbox is empty', () => {
    it('THEN nothing is handled and no consumer is called', async () => {
      const handle = vi.fn(() => Promise.resolve());

      const handled = await drainDomainEvents({
        database: testDatabase.database,
        consumers: [{ name: 'recorder', handle }],
      });

      expect(handled).toBe(0);
      expect(handle).not.toHaveBeenCalled();
    });
  });

  describe('WHEN one consumer throws', () => {
    it('THEN the other consumers still receive the event', async () => {
      await appendEvent('test.first');
      const survivor = vi.fn(() => Promise.resolve());

      await drainDomainEvents({
        database: testDatabase.database,
        consumers: [
          { name: 'broken', handle: () => Promise.reject(new Error('consumer exploded')) },
          { name: 'survivor', handle: survivor },
        ],
        onConsumerError: () => undefined,
      });

      expect(survivor).toHaveBeenCalledTimes(1);
    });

    it('THEN the failure is reported with the consumer and the event', async () => {
      await appendEvent('test.first');
      const onConsumerError = vi.fn();

      await drainDomainEvents({
        database: testDatabase.database,
        consumers: [
          { name: 'broken', handle: () => Promise.reject(new Error('consumer exploded')) },
        ],
        onConsumerError,
      });

      expect(onConsumerError).toHaveBeenCalledWith(
        'broken',
        expect.objectContaining({ name: 'test.first' }),
        expect.any(Error),
      );
    });

    it('THEN the event is still marked processed, so one bad consumer cannot stall the outbox', async () => {
      await appendEvent('test.first');

      await drainDomainEvents({
        database: testDatabase.database,
        consumers: [{ name: 'broken', handle: () => Promise.reject(new Error('boom')) }],
        onConsumerError: () => undefined,
      });

      const unprocessed = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .where('processedAt', 'is', null)
        .execute();

      expect(unprocessed).toHaveLength(0);
    });

    it('THEN no error handler is required for the drain to survive', async () => {
      await appendEvent('test.first');

      await expect(
        drainDomainEvents({
          database: testDatabase.database,
          consumers: [{ name: 'broken', handle: () => Promise.reject(new Error('boom')) }],
        }),
      ).resolves.toBe(1);
    });
  });

  describe('WHEN more events are waiting than the batch size allows', () => {
    it('THEN only one batch is claimed per pass', async () => {
      await appendEvent('test.first');
      await appendEvent('test.second');
      await appendEvent('test.third');

      const handled = await drainDomainEvents({
        database: testDatabase.database,
        consumers: [],
        batchSize: 2,
      });

      expect(handled).toBe(2);
    });

    it('THEN the remainder is picked up by the next pass', async () => {
      await appendEvent('test.first');
      await appendEvent('test.second');
      await appendEvent('test.third');
      await drainDomainEvents({ database: testDatabase.database, consumers: [], batchSize: 2 });

      const handled = await drainDomainEvents({
        database: testDatabase.database,
        consumers: [],
        batchSize: 2,
      });

      expect(handled).toBe(1);
    });
  });
});
