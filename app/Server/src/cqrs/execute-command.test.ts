import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { executeCommand } from './execute-command.js';

const COMMAND_ID = '018f0000-0000-7000-8000-0000000000aa';

describe('GIVEN a command running through executeCommand', () => {
  let testDatabase: TestDatabase;
  let accountId: string;
  let actorId: string;

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
    actorId = install.userId;
  });

  describe('WHEN the handler succeeds and appends an event', () => {
    it('THEN the handler result is returned and marked applied', async () => {
      const outcome = await executeCommand({
        database: testDatabase.database,
        commandName: 'test.doThing',
        commandId: COMMAND_ID,
        actorId,
        run: (transaction) => {
          transaction.appendEvent(buildEvent(accountId));
          return Promise.resolve({ value: 42 });
        },
      });

      expect(outcome).toEqual({ applied: true, result: { value: 42 } });
    });

    it('THEN the command is recorded so a retry can be recognised', async () => {
      await runTrivialCommand(testDatabase, { commandId: COMMAND_ID, actorId, accountId });

      const logged = await testDatabase.database
        .selectFrom('commandLog')
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(logged.commandId).toBe(COMMAND_ID);
      expect(logged.name).toBe('test.doThing');
      expect(logged.actorId).toBe(actorId);
    });

    it('THEN the event is written with a time-sortable id and left unprocessed', async () => {
      await runTrivialCommand(testDatabase, { commandId: COMMAND_ID, actorId, accountId });

      const event = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(event.name).toBe('test.thingHappened');
      expect(event.processedAt).toBeNull();
      expect(event.payload).toEqual({ detail: 'recorded' });
      // Version 7 nibble: the worker drains in occurrence order and relies on it.
      expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    });
  });

  describe('WHEN the same commandId is submitted twice', () => {
    beforeEach(async () => {
      await runTrivialCommand(testDatabase, { commandId: COMMAND_ID, actorId, accountId });
    });

    it('THEN the second call reports that it was not applied', async () => {
      const replay = await runTrivialCommand(testDatabase, {
        commandId: COMMAND_ID,
        actorId,
        accountId,
      });

      expect(replay).toEqual({ applied: false });
    });

    it('THEN the handler body does not run a second time', async () => {
      let handlerRuns = 0;

      await executeCommand({
        database: testDatabase.database,
        commandName: 'test.doThing',
        commandId: COMMAND_ID,
        actorId,
        run: () => {
          handlerRuns += 1;
          return Promise.resolve(null);
        },
      });

      expect(handlerRuns).toBe(0);
    });

    it('THEN no duplicate event is appended', async () => {
      await runTrivialCommand(testDatabase, { commandId: COMMAND_ID, actorId, accountId });

      const events = await testDatabase.database.selectFrom('domainEvent').selectAll().execute();

      expect(events).toHaveLength(1);
    });
  });

  describe('WHEN the handler throws after appending an event', () => {
    it('THEN the error reaches the caller', async () => {
      await expect(
        executeCommand({
          database: testDatabase.database,
          commandName: 'test.doThing',
          commandId: COMMAND_ID,
          actorId,
          run: (transaction) => {
            transaction.appendEvent(buildEvent(accountId));
            return Promise.reject(new Error('the invariant said no'));
          },
        }),
      ).rejects.toThrow('the invariant said no');
    });

    it('THEN no event survives, because the transaction rolled back', async () => {
      await expectRejection(testDatabase, { commandId: COMMAND_ID, actorId, accountId });

      const events = await testDatabase.database.selectFrom('domainEvent').selectAll().execute();

      expect(events).toHaveLength(0);
    });

    it('THEN the command id is released, so a corrected retry can use it', async () => {
      await expectRejection(testDatabase, { commandId: COMMAND_ID, actorId, accountId });

      const logged = await testDatabase.database.selectFrom('commandLog').selectAll().execute();

      expect(logged).toHaveLength(0);
    });
  });

  describe('WHEN a handler appends several events', () => {
    it('THEN all of them are written', async () => {
      await executeCommand({
        database: testDatabase.database,
        commandName: 'test.doThing',
        commandId: COMMAND_ID,
        actorId,
        run: (transaction) => {
          transaction.appendEvent(buildEvent(accountId, 'test.first'));
          transaction.appendEvent(buildEvent(accountId, 'test.second'));
          return Promise.resolve(null);
        },
      });

      const events = await testDatabase.database
        .selectFrom('domainEvent')
        .select('name')
        .orderBy('name')
        .execute();

      expect(events.map((event) => event.name)).toEqual(['test.first', 'test.second']);
    });
  });

  describe('WHEN a handler appends no events', () => {
    it('THEN it still commits, and the outbox stays empty', async () => {
      const outcome = await executeCommand({
        database: testDatabase.database,
        commandName: 'test.doThing',
        commandId: COMMAND_ID,
        actorId: null,
        run: () => Promise.resolve('done'),
      });

      const events = await testDatabase.database.selectFrom('domainEvent').selectAll().execute();

      expect(outcome).toEqual({ applied: true, result: 'done' });
      expect(events).toHaveLength(0);
    });
  });

  describe('WHEN a unique violation comes from somewhere other than command_log', () => {
    it('THEN it is surfaced rather than mistaken for a duplicate command', async () => {
      // Two accounts with the same slug collide on account_slug_key. Treating
      // that as "already applied" would swallow a real conflict and report
      // success for a write that never happened.
      await expect(
        executeCommand({
          database: testDatabase.database,
          commandName: 'test.doThing',
          commandId: COMMAND_ID,
          actorId: null,
          run: async (transaction) => {
            await transaction.database
              .insertInto('account')
              .values({ name: 'Duplicate', slug: 'northwind-studio' })
              .execute();
            return null;
          },
        }),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });
});

interface CommandFixture {
  readonly commandId: string;
  readonly actorId: string;
  readonly accountId: string;
}

function buildEvent(
  accountId: string,
  name = 'test.thingHappened',
): {
  accountId: string;
  aggregateType: string;
  aggregateId: string;
  name: string;
  payload: Record<string, unknown>;
} {
  return {
    accountId,
    aggregateType: 'test',
    aggregateId: accountId,
    name,
    payload: { detail: 'recorded' },
  };
}

function runTrivialCommand(
  testDatabase: TestDatabase,
  fixture: CommandFixture,
): ReturnType<typeof executeCommand<null>> {
  return executeCommand({
    database: testDatabase.database,
    commandName: 'test.doThing',
    commandId: fixture.commandId,
    actorId: fixture.actorId,
    run: (transaction) => {
      transaction.appendEvent(buildEvent(fixture.accountId));
      return Promise.resolve(null);
    },
  });
}

async function expectRejection(testDatabase: TestDatabase, fixture: CommandFixture): Promise<void> {
  await executeCommand({
    database: testDatabase.database,
    commandName: 'test.doThing',
    commandId: fixture.commandId,
    actorId: fixture.actorId,
    run: (transaction) => {
      transaction.appendEvent(buildEvent(fixture.accountId));
      return Promise.reject(new Error('the invariant said no'));
    },
  }).catch(() => undefined);
}
