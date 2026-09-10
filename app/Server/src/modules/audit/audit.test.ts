import { createSortableId } from '@lpm/database';
import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import { describedDomainEvents, hasDomainEventPhrase, type AuditTrailView } from '@lpm/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createServer } from '../../server/create-server.js';
import { readEnvironment } from '../../server/environment.js';
import { createStubObjectStore } from '../../storage/index.js';
import { createStubRedis } from '../../testing/index.js';
import { hashPassword } from '../identity/password-hasher.js';

const PASSWORD = 'correct-horse-battery';
const OWNER_EMAIL = 'jake@northwind.test';
const MEMBER_EMAIL = 'mira@northwind.test';

/** What `seedInstall` gives the owner it makes. */
const SEEDED_INITIALS = 'OP';

const testEnvironment = readEnvironment({
  NODE_ENV: 'test',
  BASE_URL: 'http://localhost:24571',
  DATABASE_URL: 'postgres://unused',
  REDIS_URL: 'redis://unused',
  S3_ENDPOINT: 'http://unused:9000',
  S3_BUCKET: 'lpm-test',
  S3_ACCESS_KEY: 'unused',
  S3_SECRET_KEY: 'unused',
});

let commandCounter = 0;

function nextCommandId(): string {
  commandCounter += 1;
  return `018f8888-0000-7000-8000-${String(commandCounter).padStart(12, '0')}`;
}

function readSessionCookie(cookies: readonly { name: string; value: string }[]): string {
  const cookie = cookies.find((candidate) => candidate.name === 'lpm_session');

  if (cookie === undefined) {
    throw new Error('Expected a session cookie to have been set.');
  }

  return cookie.value;
}

describe('GIVEN an install that has been used', () => {
  const redis = createStubRedis();

  let testDatabase: TestDatabase;
  let server: FastifyInstance;
  let passwordHash: string;
  let ownerCookie: string;
  let projectId: string;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    passwordHash = await hashPassword(PASSWORD);
    server = await createServer({
      environment: testEnvironment,
      database: testDatabase.database,
      redis,
      storage: createStubObjectStore(),
    });
  });

  afterAll(async () => {
    await server.close();
    await testDatabase.close();
  });

  beforeEach(async () => {
    await testDatabase.truncateAllTables();
    redis.forgetEverything();

    await seedInstall(testDatabase.database, {
      email: OWNER_EMAIL,
      passwordHash,
      displayName: 'Jake Winters',
    });

    ownerCookie = await signIn(OWNER_EMAIL);
    projectId = (await command('projects.create', { name: 'Saltmarsh', code: 'SLTM' })).json<{
      id: string;
    }>().id;
  });

  async function signIn(email: string): Promise<string> {
    return readSessionCookie(
      (
        await server.inject({
          method: 'POST',
          url: '/api/c/identity.signIn',
          payload: { commandId: nextCommandId(), email, password: PASSWORD },
        })
      ).cookies,
    );
  }

  async function command(
    name: string,
    body: Record<string, unknown>,
    cookie = ownerCookie,
  ): Promise<Awaited<ReturnType<typeof server.inject>>> {
    return server.inject({
      method: 'POST',
      url: `/api/c/${name}`,
      payload: { commandId: nextCommandId(), ...body },
      cookies: { lpm_session: cookie },
    });
  }

  async function readTrail(
    search = '',
    cookie = ownerCookie,
  ): Promise<Awaited<ReturnType<typeof server.inject>>> {
    return server.inject({
      method: 'GET',
      url: `/api/q/audit.trail${search}`,
      cookies: { lpm_session: cookie },
    });
  }

  async function trail(search = ''): Promise<AuditTrailView> {
    return (await readTrail(search)).json<{ data: AuditTrailView }>().data;
  }

  describe('WHEN the owner asks what has happened', () => {
    it('THEN the newest thing is first', async () => {
      const { entries } = await trail();

      expect(entries[0]?.name).toBe('projects.projectCreated');
    });

    it('THEN it says who did it, without being asked a second time', async () => {
      // The name comes from the same statement as the event, so a trail of a
      // thousand entries is one query rather than a thousand and one.
      const { entries } = await trail();

      expect(entries[0]?.actor?.displayName).toBe('Jake Winters');
      // The initials the account stores, not ones derived again here: an avatar
      // on the board and a name in the trail must not be two different
      // abbreviations of the same person.
      expect(entries[0]?.actor?.initials).toBe(SEEDED_INITIALS);
    });

    it('THEN it says what the thing was called, not only what its id is', async () => {
      expect((await trail()).entries[0]?.subject).toMatchObject({
        kind: 'project',
        label: 'Saltmarsh',
      });
    });

    it('THEN a card names itself by its key', async () => {
      const list = await testDatabase.database
        .selectFrom('list')
        .select('id')
        .orderBy('position')
        .executeTakeFirstOrThrow();

      await command('board.createCard', {
        projectId,
        listId: list.id,
        title: 'Harbour crane retopo',
        type: 'art',
      });

      const [newest] = (await trail()).entries;

      expect(newest?.name).toBe('board.cardCreated');
      expect(newest?.subject).toMatchObject({ kind: 'card', label: 'SLTM-ART-1' });
    });

    it('THEN what the server did to itself has no actor, which is not nobody', async () => {
      // The worker writes these when it reads a delivery: something happened,
      // and no person did it.
      await testDatabase.database
        .insertInto('domainEvent')
        .values({
          id: createSortableId(),
          accountId: (
            await testDatabase.database.selectFrom('account').select('id').executeTakeFirstOrThrow()
          ).id,
          aggregateType: 'card',
          aggregateId: '018f0000-0000-7000-8000-000000000000',
          name: 'scm.linked',
          payload: JSON.stringify({}),
          actorId: null,
        })
        .execute();

      const [newest] = (await trail()).entries;

      expect(newest?.name).toBe('scm.linked');
      expect(newest?.actor).toBeNull();
      // The card it names is gone, and the entry still says what kind of thing
      // it was.
      expect(newest?.subject).toMatchObject({ kind: 'card', label: null });
    });
  });

  describe('WHEN there is more than a page of it', () => {
    it('THEN a cursor reads on from where the last page stopped', async () => {
      const list = await testDatabase.database
        .selectFrom('list')
        .select('id')
        .orderBy('position')
        .executeTakeFirstOrThrow();

      for (let card = 0; card < 3; card += 1) {
        await command('board.createCard', {
          projectId,
          listId: list.id,
          title: `Card ${String(card)}`,
          type: 'task',
        });
      }

      const newest = (await trail()).entries[0];
      const after = await trail(`?before=${newest?.id ?? ''}`);

      // Strictly older, so nothing is shown twice while the trail grows at the
      // head somebody is reading from. Ids are time-ordered, so comparing them
      // as text compares them as moments.
      expect(after.entries[0]?.id).not.toBe(newest?.id);
      expect(after.entries[0]?.id.localeCompare(newest?.id ?? '')).toBeLessThan(0);
    });

    it('THEN the last page says there is no more', async () => {
      expect((await trail()).nextCursor).toBeNull();
    });
  });

  describe('WHEN it is narrowed to one project', () => {
    it('THEN only what happened in that project comes back', async () => {
      const other = (
        await command('projects.create', { name: 'Drowned Reach', code: 'DRCH' })
      ).json<{ id: string }>().id;

      const { entries } = await trail(`?projectId=${other}`);

      expect(entries).toHaveLength(1);
      expect(entries[0]?.subject.label).toBe('Drowned Reach');
    });

    it('THEN a deleted card is still in its project, though there is nothing left to join to', async () => {
      const list = await testDatabase.database
        .selectFrom('list')
        .select('id')
        .orderBy('position')
        .executeTakeFirstOrThrow();

      const cardId = (
        await command('board.createCard', {
          projectId,
          listId: list.id,
          title: 'Typed by mistake',
          type: 'task',
        })
      ).json<{ id: string }>().id;

      await command('board.deleteCard', { cardId });

      const { entries } = await trail(`?projectId=${projectId}`);

      /*
       * Every other entry about a card is filed by joining the trail to the
       * card. This is the one where the row is gone by the time anybody reads
       * it — so the entry somebody filtering a project most wants, who deleted
       * it, is the one the join would have dropped.
       */
      expect(entries[0]?.name).toBe('board.cardDeleted');
    });

    it('THEN a list is still left out of it, though its event names the project too', async () => {
      const board = await testDatabase.database
        .selectFrom('board')
        .select('id')
        .where('projectId', '=', projectId)
        .executeTakeFirstOrThrow();

      await command('board.createList', { boardId: board.id, name: 'Blocked', color: '#eda363' });

      const { entries } = await trail(`?projectId=${projectId}`);

      // The rule is the project or a card in it. Nearly every event carries a
      // project in its payload, so reading that rather than the aggregate would
      // pull in the entries this deliberately leaves out.
      expect(entries.map((entry) => entry.name)).not.toContain('board.listCreated');
    });
  });

  describe('WHEN it is narrowed to one kind of thing', () => {
    it('THEN only events about that kind come back', async () => {
      await command('teams.create', { name: 'Audio' });

      const { entries } = await trail('?kind=team');

      expect(entries).toHaveLength(1);
      expect(entries[0]?.subject.kind).toBe('team');
      expect(entries[0]?.subject.label).toBe('Audio');
    });

    it('THEN the project it happened in still narrows it further', async () => {
      const other = (
        await command('projects.create', { name: 'Drowned Reach', code: 'DRCH' })
      ).json<{ id: string }>().id;

      await command('teams.create', { name: 'Audio' });

      // Both, and they agree: a team is not in a project, so asking for teams
      // in one project is a question with no answer rather than a filter that
      // quietly drops one half.
      expect((await trail(`?kind=team&projectId=${other}`)).entries).toHaveLength(0);
      expect((await trail(`?kind=project&projectId=${other}`)).entries).toHaveLength(1);
    });
  });

  describe('WHEN somebody searches it', () => {
    it('THEN what a thing is called finds what happened to it', async () => {
      await command('projects.create', { name: 'Drowned Reach', code: 'DRCH' });

      const { entries } = await trail('?search=drowned');

      expect(entries).toHaveLength(1);
      expect(entries[0]?.subject.label).toBe('Drowned Reach');
    });

    it('THEN the person who did it finds it too', async () => {
      const { entries } = await trail('?search=winters');

      // Everything in this install so far was done by the owner, and the trail
      // is not empty, so a name matching nothing would be the bug.
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((entry) => entry.actor?.displayName === 'Jake Winters')).toBe(true);
    });

    it('THEN what happened finds it, in the words the event was recorded in', async () => {
      // `projects.projectCreated` is what the row holds. The phrase the screen
      // puts it into lives in the client, and is not a thing SQL can see.
      const { entries } = await trail('?search=projectCreated');

      expect(entries).toHaveLength(1);
      expect(entries[0]?.name).toBe('projects.projectCreated');
    });

    it('THEN words that are in none of it come back with nothing', async () => {
      expect((await trail('?search=gwmzqx')).entries).toHaveLength(0);
    });

    it('THEN a search of nothing but spaces is not a search at all', async () => {
      const everything = await trail();
      const spaces = await trail('?search=%20%20');

      expect(spaces.entries).toHaveLength(everything.entries.length);
    });
  });

  describe('WHEN somebody who does not run the install asks', () => {
    it('THEN they are refused, because it names every project including theirs', async () => {
      await testDatabase.database
        .insertInto('appUser')
        .values({
          id: '018f9999-0000-7000-8000-000000000001',
          email: MEMBER_EMAIL,
          displayName: 'Mira Kaur',
          initials: 'MK',
          passwordHash,
          status: 'active',
        })
        .execute();

      await testDatabase.database
        .insertInto('membership')
        .values({
          userId: '018f9999-0000-7000-8000-000000000001',
          accountId: (
            await testDatabase.database.selectFrom('account').select('id').executeTakeFirstOrThrow()
          ).id,
          role: 'member',
        })
        .execute();

      const response = await readTrail('', await signIn(MEMBER_EMAIL));

      expect(response.statusCode).toBe(403);
    });

    it('THEN a visitor with no session is refused too', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/q/audit.trail' });

      expect(response.statusCode).toBe(401);
    });
  });
});

describe('GIVEN the words the trail is written in', () => {
  describe('WHEN an event is shown', () => {
    it('THEN every one it knows has a phrase that is not its own name', () => {
      for (const name of describedDomainEvents()) {
        expect(hasDomainEventPhrase(name)).toBe(true);
      }
    });
  });
});
