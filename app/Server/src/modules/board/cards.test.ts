import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import type { BoardView, CardDetailView } from '@lpm/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { MembershipRole } from '../../domain/index.js';
import { createStubObjectStore } from '../../storage/index.js';
import { createStubRedis } from '../../testing/index.js';
import { createServer } from '../../server/create-server.js';
import { readEnvironment } from '../../server/environment.js';
import { hashPassword } from '../identity/password-hasher.js';

const PASSWORD = 'correct-horse-battery';
const OWNER_EMAIL = 'jake@northwind.test';

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

/**
 * Enough of Redis for a server to start: a health probe, and the subscriber the
 * realtime hub opens. Nothing publishes in these tests, so nothing arrives.
 */
let commandCounter = 0;

function nextCommandId(): string {
  commandCounter += 1;
  return `018f3333-0000-7000-8000-${String(commandCounter).padStart(12, '0')}`;
}

function readSessionCookie(cookies: readonly { name: string; value: string }[]): string {
  const cookie = cookies.find((candidate) => candidate.name === 'lpm_session');

  if (cookie === undefined) {
    throw new Error('Expected a session cookie to have been set.');
  }

  return cookie.value;
}

describe('GIVEN a board that can be written to', () => {
  let testDatabase: TestDatabase;
  let server: FastifyInstance;
  let passwordHash: string;
  let accountId: string;
  let ownerCookie: string;
  let projectId: string;
  let lists: { id: string; name: string }[];

  const redis = createStubRedis();

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

    const install = await seedInstall(testDatabase.database, {
      email: OWNER_EMAIL,
      passwordHash,
      displayName: 'Jake Winters',
    });

    accountId = install.accountId;
    ownerCookie = await signIn(OWNER_EMAIL);

    const created = await command('projects.create', { name: 'Drowned Reach', code: 'DRCH' });
    projectId = created.json<{ id: string }>().id;

    lists = await testDatabase.database
      .selectFrom('list')
      .select(['id', 'name'])
      .orderBy('position')
      .execute();
  });

  function post(name: string, body: Record<string, unknown>, cookie: string): InjectOptions {
    return {
      method: 'POST',
      url: `/api/c/${name}`,
      payload: { commandId: nextCommandId(), ...body },
      cookies: { lpm_session: cookie },
    };
  }

  async function command(
    name: string,
    body: Record<string, unknown>,
    cookie = ownerCookie,
  ): Promise<Awaited<ReturnType<typeof server.inject>>> {
    return server.inject(post(name, body, cookie));
  }

  async function signIn(email: string): Promise<string> {
    const response = await server.inject({
      method: 'POST',
      url: '/api/c/identity.signIn',
      payload: { commandId: nextCommandId(), email, password: PASSWORD },
    });

    return readSessionCookie(response.cookies);
  }

  async function seedTeammate(role: MembershipRole, email: string): Promise<string> {
    const user = await testDatabase.database
      .insertInto('appUser')
      .values({ email, passwordHash, displayName: 'Team Mate', initials: 'TM', status: 'active' })
      .returning('id')
      .executeTakeFirstOrThrow();

    await testDatabase.database
      .insertInto('membership')
      .values({ accountId, userId: user.id, role })
      .execute();

    return user.id;
  }

  function listId(name: string): string {
    const found = lists.find((list) => list.name === name);

    if (found === undefined) {
      throw new Error(`No list called ${name}.`);
    }

    return found.id;
  }

  async function createCard(
    title: string,
    options: { list?: string; type?: string; cookie?: string } = {},
  ): Promise<string> {
    const response = await command(
      'board.createCard',
      {
        projectId,
        listId: listId(options.list ?? 'Backlog'),
        title,
        type: options.type ?? 'task',
      },
      options.cookie ?? ownerCookie,
    );

    const json = response.json<{ ok: boolean; id?: string }>();

    if (!json.ok || json.id === undefined) {
      throw new Error(`Expected "${title}" to be created, got ${JSON.stringify(json)}.`);
    }

    return json.id;
  }

  async function readBoard(): Promise<BoardView> {
    const response = await server.inject({
      method: 'GET',
      url: '/api/q/board.view?slug=drowned-reach',
      cookies: { lpm_session: ownerCookie },
    });

    return response.json<{ data: BoardView }>().data;
  }

  /** The card titles in one list, in the order the board returns them. */
  async function order(listName: string): Promise<string[]> {
    const board = await readBoard();
    const list = board.lists.find((candidate) => candidate.name === listName);

    return (list?.cards ?? []).map((card) => card.title);
  }

  describe('WHEN a card is created', () => {
    it('THEN it takes the next key for its type', async () => {
      await createCard('First art', { type: 'art' });
      await createCard('Second art', { type: 'art' });
      await createCard('A task', { type: 'task' });

      const cards = await testDatabase.database
        .selectFrom('card')
        .select(['cardKey', 'title'])
        .orderBy('cardKey')
        .execute();

      expect(cards.map((card) => card.cardKey).sort()).toEqual([
        'DRCH-ART-1',
        'DRCH-ART-2',
        'DRCH-TASK-1',
      ]);
    });

    it('THEN it goes to the end of its list', async () => {
      await createCard('First');
      await createCard('Second');
      await createCard('Third');

      expect(await order('Backlog')).toEqual(['First', 'Second', 'Third']);
    });

    it('THEN whoever made it is its reporter', async () => {
      await createCard('Mine');

      const card = await testDatabase.database
        .selectFrom('card')
        .innerJoin('appUser', 'appUser.id', 'card.reporterId')
        .select('appUser.email')
        .executeTakeFirstOrThrow();

      expect(card.email).toBe(OWNER_EMAIL);
    });

    it('THEN a cardCreated event is appended', async () => {
      await createCard('Watched');

      const event = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .where('name', '=', 'board.cardCreated')
        .executeTakeFirstOrThrow();

      expect(event.aggregateType).toBe('card');
    });

    it('THEN a list already at its limit refuses it', async () => {
      // "Ready for review" is limited to four.
      for (let index = 0; index < 4; index++) {
        await createCard(`Review ${String(index)}`, { list: 'Ready for review' });
      }

      const response = await command('board.createCard', {
        projectId,
        listId: listId('Ready for review'),
        title: 'One too many',
        type: 'task',
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'WIP_LIMIT_REACHED' });
    });

    it('THEN a list on another board refuses it', async () => {
      const other = await command('projects.create', { name: 'Kiln', code: 'KILN' });
      const otherProjectId = other.json<{ id: string }>().id;
      const otherList = await testDatabase.database
        .selectFrom('list')
        .innerJoin('board', 'board.id', 'list.boardId')
        .select('list.id as id')
        .where('board.projectId', '=', otherProjectId)
        .executeTakeFirstOrThrow();

      const response = await command('board.createCard', {
        projectId,
        listId: otherList.id,
        title: 'Wrong board',
        type: 'task',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN a card is edited', () => {
    let cardId: string;

    beforeEach(async () => {
      cardId = await createCard('Harbour crane retopo', { type: 'art' });
    });

    it('THEN only the fields that were sent change', async () => {
      await command('board.updateCard', { cardId, points: 5, priority: 'high' });

      const card = await testDatabase.database
        .selectFrom('card')
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(card).toMatchObject({
        points: 5,
        priority: 'high',
        title: 'Harbour crane retopo',
        type: 'art',
      });
    });

    it('THEN a field sent as null is cleared', async () => {
      await command('board.updateCard', { cardId, points: 5 });
      await command('board.updateCard', { cardId, points: null });

      const card = await testDatabase.database
        .selectFrom('card')
        .select('points')
        .executeTakeFirstOrThrow();

      expect(card.points).toBeNull();
    });

    it('THEN changing its type does not change the key it was issued', async () => {
      // Somebody put DRCH-ART-1 in a commit message. A key that moved to make a
      // prefix tidy would break that.
      await command('board.updateCard', { cardId, type: 'bug' });

      const card = await testDatabase.database
        .selectFrom('card')
        .select(['cardKey', 'type'])
        .executeTakeFirstOrThrow();

      expect(card).toMatchObject({ cardKey: 'DRCH-ART-1', type: 'bug' });
    });

    it('THEN an edit cannot close it, whatever it says', async () => {
      // Closing is a move, so a flag here would be a second answer to what
      // finished means — see `closingStampFor`. The envelope drops what the
      // schema does not name, so this is ignored rather than refused.
      await command('board.updateCard', { cardId, closed: true });

      const stored = await testDatabase.database
        .selectFrom('card')
        .select('closedAt')
        .executeTakeFirstOrThrow();

      expect(stored.closedAt).toBeNull();
    });

    it('THEN moving it to the list the board finishes on is what closes it', async () => {
      await command('board.moveCard', { cardId, toListId: listId('Done') });

      const closed = await testDatabase.database
        .selectFrom('card')
        .select('closedAt')
        .executeTakeFirstOrThrow();

      expect(closed.closedAt).not.toBeNull();

      // And it is still drawn there, in the column it was closed in.
      expect(await order('Done')).toContain('Harbour crane retopo');
    });

    it('THEN taking it back out opens it again', async () => {
      await command('board.moveCard', { cardId, toListId: listId('Done') });
      await command('board.moveCard', { cardId, toListId: listId('In progress') });

      const reopened = await testDatabase.database
        .selectFrom('card')
        .select('closedAt')
        .executeTakeFirstOrThrow();

      expect(reopened.closedAt).toBeNull();
    });

    it('THEN an edit with nothing in it writes nothing at all', async () => {
      await command('board.updateCard', { cardId });

      const events = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .where('name', '=', 'board.cardUpdated')
        .execute();

      expect(events).toHaveLength(0);
    });

    it('THEN the event names what moved without repeating the values', async () => {
      await command('board.updateCard', { cardId, description: 'Something private' });

      const event = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .where('name', '=', 'board.cardUpdated')
        .executeTakeFirstOrThrow();

      expect(event.payload).toMatchObject({ changedFields: ['description'] });
      expect(JSON.stringify(event.payload)).not.toContain('Something private');
    });
  });

  describe('WHEN a card is moved', () => {
    let first: string;
    let second: string;
    let third: string;

    beforeEach(async () => {
      first = await createCard('First');
      second = await createCard('Second');
      third = await createCard('Third');
    });

    it('THEN it lands between the two cards it was dropped between', async () => {
      await command('board.moveCard', {
        cardId: third,
        toListId: listId('Backlog'),
        afterCardId: first,
        beforeCardId: second,
      });

      expect(await order('Backlog')).toEqual(['First', 'Third', 'Second']);
    });

    it('THEN it can be moved to the top of its list', async () => {
      await command('board.moveCard', {
        cardId: third,
        toListId: listId('Backlog'),
        beforeCardId: first,
      });

      expect(await order('Backlog')).toEqual(['Third', 'First', 'Second']);
    });

    it('THEN naming no neighbours puts it at the end', async () => {
      await command('board.moveCard', { cardId: first, toListId: listId('Backlog') });

      expect(await order('Backlog')).toEqual(['Second', 'Third', 'First']);
    });

    it('THEN it can move to another list', async () => {
      await command('board.moveCard', { cardId: second, toListId: listId('In progress') });

      expect(await order('Backlog')).toEqual(['First', 'Third']);
      expect(await order('In progress')).toEqual(['Second']);
    });

    it('THEN a cardMoved event records where it came from and went', async () => {
      await command('board.moveCard', { cardId: second, toListId: listId('In progress') });

      const event = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .where('name', '=', 'board.cardMoved')
        .executeTakeFirstOrThrow();

      expect(event.payload).toMatchObject({
        fromListId: listId('Backlog'),
        toListId: listId('In progress'),
      });
    });

    it('THEN a list at its limit refuses the arrival', async () => {
      for (let index = 0; index < 4; index++) {
        await createCard(`Review ${String(index)}`, { list: 'Ready for review' });
      }

      const response = await command('board.moveCard', {
        cardId: first,
        toListId: listId('Ready for review'),
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'WIP_LIMIT_REACHED' });
      expect(await order('Backlog')).toEqual(['First', 'Second', 'Third']);
    });

    it('THEN reordering inside a full list is still allowed', async () => {
      // The limit is about how much is in the list, and reordering changes none
      // of that.
      const reviewCards: string[] = [];

      for (let index = 0; index < 4; index++) {
        reviewCards.push(await createCard(`Review ${String(index)}`, { list: 'Ready for review' }));
      }

      const response = await command('board.moveCard', {
        cardId: reviewCards[3],
        toListId: listId('Ready for review'),
        beforeCardId: reviewCards[0],
      });

      expect(response.json()).toMatchObject({ ok: true });
      expect(await order('Ready for review')).toEqual([
        'Review 3',
        'Review 0',
        'Review 1',
        'Review 2',
      ]);
    });

    it('THEN an advisory limit lets the card in anyway', async () => {
      await testDatabase.database
        .updateTable('project')
        .set({ wipIsAdvisory: true })
        .where('id', '=', projectId)
        .execute();

      for (let index = 0; index < 4; index++) {
        await createCard(`Review ${String(index)}`, { list: 'Ready for review' });
      }

      const response = await command('board.moveCard', {
        cardId: first,
        toListId: listId('Ready for review'),
      });

      expect(response.json()).toMatchObject({ ok: true });
    });

    it('THEN repeated drops into the same gap keep working', async () => {
      // Halving a gap forty times exhausts a double. The list is reindexed when
      // that happens, and this is the only thing that proves it.
      for (let index = 0; index < 60; index++) {
        const response = await command('board.moveCard', {
          cardId: third,
          toListId: listId('Backlog'),
          afterCardId: first,
          beforeCardId: second,
        });

        expect(response.json()).toMatchObject({ ok: true });
      }

      expect(await order('Backlog')).toEqual(['First', 'Third', 'Second']);
    });
  });

  describe('WHEN a card is deleted', () => {
    it('THEN it is off the board', async () => {
      const cardId = await createCard('Typed by mistake');

      const response = await command('board.deleteCard', { cardId });

      expect(response.statusCode).toBe(200);
      expect(await order('Backlog')).toEqual([]);
    });

    it('THEN everything that was on it goes too', async () => {
      const cardId = await createCard('Noise off an import');

      await command('board.addSubtask', { cardId, title: 'Also noise' });
      await command('board.comment', { cardId, body: 'Why is this here?' });
      await command('board.deleteCard', { cardId });

      const subtasks = await testDatabase.database
        .selectFrom('subtask')
        .select('id')
        .where('cardId', '=', cardId)
        .execute();
      const comments = await testDatabase.database
        .selectFrom('comment')
        .select('id')
        .where('cardId', '=', cardId)
        .execute();

      expect(subtasks).toEqual([]);
      expect(comments).toEqual([]);
    });

    it('THEN the key it had is never handed out again', async () => {
      const first = await createCard('First');
      await command('board.deleteCard', { cardId: first });
      const second = await createCard('Second');

      const card = await testDatabase.database
        .selectFrom('card')
        .select('cardKey')
        .where('id', '=', second)
        .executeTakeFirstOrThrow();

      // The number is on commits and in the audit trail. Reissuing it would
      // point two different pieces of work at one string.
      expect(card.cardKey).toBe('DRCH-TASK-2');
    });

    it('THEN the entry in the trail carries the key, which nothing can look up afterwards', async () => {
      const cardId = await createCard('Gone');
      await command('board.deleteCard', { cardId });

      const event = await testDatabase.database
        .selectFrom('domainEvent')
        .select(['name', 'payload'])
        .where('aggregateId', '=', cardId)
        .where('name', '=', 'board.cardDeleted')
        .executeTakeFirstOrThrow();

      expect(event.payload).toMatchObject({ projectId, cardKey: 'DRCH-TASK-1' });
    });

    it('THEN the cards under a legend stay on the board, unclumped', async () => {
      const legend = await createCard('Harbour set');
      const child = await createCard('Crane');

      await command('board.setLegend', { cardId: legend, isLegend: true });
      await command('board.putUnderLegend', { cardId: child, legendKey: 'DRCH-TASK-1' });
      await command('board.deleteCard', { cardId: legend });

      const survivor = await testDatabase.database
        .selectFrom('card')
        .select(['id', 'legendId'])
        .where('id', '=', child)
        .executeTakeFirstOrThrow();

      // Deleting the legend loses the grouping, not the work under it.
      expect(survivor.legendId).toBeNull();
    });

    it('THEN a card in another project is not found', async () => {
      const cardId = await createCard('Theirs');
      await seedTeammate('member', 'stranger@northwind.test');

      const response = await command(
        'board.deleteCard',
        { cardId },
        await signIn('stranger@northwind.test'),
      );

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN somebody is put on a card', () => {
    /** On the project, so a card may name them. */
    async function seedMember(email: string): Promise<string> {
      const userId = await seedTeammate('member', email);

      await command('projects.addMember', { projectId, userId });

      return userId;
    }

    it('THEN the card says who it belongs to and who raised it', async () => {
      const cardId = await createCard('Harbour crane retopo');
      const mira = await seedMember('mira@northwind.test');
      const leo = await seedMember('leo@northwind.test');

      const response = await command('board.updateCard', {
        cardId,
        assigneeId: mira,
        reporterId: leo,
      });

      expect(response.statusCode).toBe(200);

      const card = await testDatabase.database
        .selectFrom('card')
        .select(['assigneeId', 'reporterId'])
        .where('id', '=', cardId)
        .executeTakeFirstOrThrow();

      expect(card.assigneeId).toBe(mira);
      expect(card.reporterId).toBe(leo);
    });

    it('THEN a reporter can be changed, because filing it is not raising it', async () => {
      // A producer types in half the board. The person worth going back to is
      // the one who saw the problem, not the one who wrote it down.
      const cardId = await createCard('Harbour crane retopo');
      const mira = await seedMember('mira@northwind.test');

      await command('board.updateCard', { cardId, reporterId: mira });

      const card = await testDatabase.database
        .selectFrom('card')
        .select('reporterId')
        .where('id', '=', cardId)
        .executeTakeFirstOrThrow();

      expect(card.reporterId).toBe(mira);
    });

    it('THEN somebody who cannot reach the project is refused', async () => {
      /*
       * Assigning work to somebody who cannot open the board is a card the one
       * person supposed to be looking at it will never see. The picker offers
       * nobody else; this is what holds when the picker was not what put the
       * name there.
       */
      const cardId = await createCard('Harbour crane retopo');
      const outsider = await seedTeammate('member', 'outsider@northwind.test');

      const response = await command('board.updateCard', { cardId, assigneeId: outsider });

      expect(response.statusCode).toBe(422);

      const card = await testDatabase.database
        .selectFrom('card')
        .select('assigneeId')
        .where('id', '=', cardId)
        .executeTakeFirstOrThrow();

      // And nothing was written: the check runs before the update, so a card is
      // never briefly given to somebody who cannot open it.
      expect(card.assigneeId).toBeNull();
    });

    it('THEN a reporter who cannot reach the project is refused the same way', async () => {
      const cardId = await createCard('Harbour crane retopo');
      const outsider = await seedTeammate('member', 'outsider@northwind.test');

      const response = await command('board.updateCard', { cardId, reporterId: outsider });

      expect(response.statusCode).toBe(422);
    });

    it('THEN a card cannot be created already given to one', async () => {
      const outsider = await seedTeammate('member', 'outsider@northwind.test');

      const response = await command('board.createCard', {
        projectId,
        listId: listId('Backlog'),
        title: 'Given away on arrival',
        type: 'task',
        assigneeId: outsider,
      });

      expect(response.statusCode).toBe(422);
    });

    it('THEN a lead who is not on it is refused, though they can open every board', async () => {
      /*
       * The narrower of the two questions, and the point of asking it.
       *
       * A lead makes the projects and can open all of them. That is not the
       * same as being on this one, and a card given to somebody who has never
       * worked on the job is a card nobody picks up. The mention picker still
       * offers them, because asking them a question about a card they can read
       * is a different act.
       */
      const cardId = await createCard('Harbour crane retopo');
      const lead = await seedTeammate('lead', 'lead@northwind.test');

      const response = await command('board.updateCard', { cardId, assigneeId: lead });

      expect(response.statusCode).toBe(422);
    });

    it('THEN whoever made the project is on it, so a card can name them', async () => {
      // Creating a project puts you on it by name. Without that the crew list
      // would be empty on a fresh install, for the one person there is.
      const cardId = await createCard('Harbour crane retopo');
      const owner = await testDatabase.database
        .selectFrom('appUser')
        .select('id')
        .where('email', '=', OWNER_EMAIL)
        .executeTakeFirstOrThrow();

      const response = await command('board.updateCard', { cardId, reporterId: owner.id });

      expect(response.statusCode).toBe(200);
    });

    it('THEN somebody reached through a team counts, because they are on it', async () => {
      // Being on a project by name and being in a team that is on it are the
      // two ways of being on it. A picker that offered them and an edit that
      // refused them would be two answers to one question.
      const cardId = await createCard('Harbour crane retopo');
      const mira = await seedTeammate('member', 'mira@northwind.test');

      const team = await command('teams.create', { name: 'Environment' });
      const teamId = team.json<{ id: string }>().id;

      await command('teams.addMember', { teamId, userId: mira });
      await command('projects.addTeam', { projectId, teamId });

      const response = await command('board.updateCard', { cardId, assigneeId: mira });

      expect(response.statusCode).toBe(200);
    });

    it('THEN nobody is always allowed, because clearing is not naming', async () => {
      const cardId = await createCard('Harbour crane retopo');
      const mira = await seedMember('mira@northwind.test');

      await command('board.updateCard', { cardId, assigneeId: mira });

      const response = await command('board.updateCard', { cardId, assigneeId: null });

      expect(response.statusCode).toBe(200);

      const card = await testDatabase.database
        .selectFrom('card')
        .select('assigneeId')
        .where('id', '=', cardId)
        .executeTakeFirstOrThrow();

      expect(card.assigneeId).toBeNull();
    });
  });

  describe('WHEN somebody logs the hours they worked', () => {
    /** Eight hours, which is what a working day is here. */
    const A_DAY = 8 * 60;

    /** Today, as the browser sends it. */
    const today = (): string => new Date().toISOString().slice(0, 10);

    async function detail(cardId: string, cookie = ownerCookie): Promise<CardDetailView> {
      const response = await server.inject({
        method: 'GET',
        url: `/api/q/board.cardDetail?cardId=${cardId}`,
        cookies: { lpm_session: cookie },
      });

      return response.json<{ data: CardDetailView }>().data;
    }

    async function onTheProject(email: string): Promise<string> {
      const userId = await seedTeammate('member', email);

      await command('projects.addMember', { projectId, userId });

      return userId;
    }

    it('THEN the card says how long it has taken, beside what it was meant to', async () => {
      // The pair a producer actually reads. The estimate is what it was expected
      // to take; this is what it took, and the gap is the interesting number.
      const cardId = await createCard('Harbour crane retopo');

      await command('board.updateCard', { cardId, estimateMinutes: 2 * A_DAY });
      await command('work.log', { cardId, minutes: 210, workedOn: today(), note: 'deck normals' });

      const card = await detail(cardId);

      expect(card.estimateMinutes).toBe(2 * A_DAY);
      expect(card.work.loggedMinutes).toBe(210);
      expect(card.work.entries[0]).toMatchObject({
        minutes: 210,
        note: 'deck normals',
        who: { displayName: 'Jake Winters' },
        // Theirs, so the panel offers to take it back off.
        isMine: true,
      });
    });

    it('THEN several entries add up, because that is every question asked of them', async () => {
      const cardId = await createCard('Harbour crane retopo');

      await command('work.log', { cardId, minutes: 210, workedOn: today() });
      await command('work.log', { cardId, minutes: A_DAY, workedOn: today() });

      expect((await detail(cardId)).work.loggedMinutes).toBe(210 + A_DAY);
    });

    it('THEN it is recorded against whoever logged it, and nobody else', async () => {
      /*
       * There is no name on the command, and this is the test that says adding
       * one would change what an entry means. An entry is "I did this", and a
       * sheet other people can write into is one nobody can vouch for.
       */
      const cardId = await createCard('Harbour crane retopo');
      const mira = await onTheProject('mira@northwind.test');

      await command('work.log', { cardId, minutes: 60, workedOn: today(), userId: mira });

      const entry = await testDatabase.database
        .selectFrom('workLog')
        .select('userId')
        .executeTakeFirstOrThrow();

      expect(entry.userId).not.toBe(mira);
    });

    it('THEN somebody else’s hours count, and are not theirs to take off', async () => {
      const cardId = await createCard('Harbour crane retopo');
      const mira = await onTheProject('mira@northwind.test');
      const hers = await signIn('mira@northwind.test');

      await command('work.log', { cardId, minutes: 120, workedOn: today() }, hers);

      const asOwner = await detail(cardId);

      expect(asOwner.work.loggedMinutes).toBe(120);
      expect(asOwner.work.entries[0]?.who?.userId).toBe(mira);
      // The owner may edit every field on this card and still may not touch her
      // account of her own week.
      expect(asOwner.work.entries[0]?.isMine).toBe(false);

      await command('work.remove', { entryId: asOwner.work.entries[0]?.id ?? '' });

      expect((await detail(cardId)).work.loggedMinutes).toBe(120);
    });

    it('THEN their own comes back off, and the total follows it down', async () => {
      const cardId = await createCard('Harbour crane retopo');

      await command('work.log', { cardId, minutes: 210, workedOn: today() });
      await command('work.log', { cardId, minutes: 60, workedOn: today() });

      const entries = (await detail(cardId)).work.entries;

      await command('work.remove', { entryId: entries[0]?.id ?? '' });

      const after = await detail(cardId);

      expect(after.work.entries).toHaveLength(1);
      expect(after.work.loggedMinutes).toBe(270 - (entries[0]?.minutes ?? 0));
    });

    it('THEN a day that has not happened yet is refused', async () => {
      // The mistake this catches is a year typed as 2027, which otherwise sits
      // in the sheet until somebody totals a quarter.
      const cardId = await createCard('Harbour crane retopo');
      const wayAhead = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const response = await command('work.log', { cardId, minutes: 60, workedOn: wayAhead });

      expect(response.statusCode).toBe(422);
    });

    it('THEN nothing is logged against a card in a project they cannot reach', async () => {
      const cardId = await createCard('Harbour crane retopo');
      await seedTeammate('member', 'outsider@northwind.test');

      const response = await command(
        'work.log',
        { cardId, minutes: 60, workedOn: today() },
        await signIn('outsider@northwind.test'),
      );

      expect(response.statusCode).toBe(404);
    });

    it('THEN an entry about neither a card nor an asset is refused', async () => {
      const response = await command('work.log', { minutes: 60, workedOn: today() });

      expect(response.statusCode).toBe(422);
    });

    it('THEN an entry about both is refused, because it would be counted twice', async () => {
      const cardId = await createCard('Harbour crane retopo');

      const response = await command('work.log', {
        cardId,
        assetId: '018f0000-0000-7000-8000-0000000000ff',
        minutes: 60,
        workedOn: today(),
      });

      expect(response.statusCode).toBe(422);
    });

    it('THEN deleting the card takes the hours with it', async () => {
      const cardId = await createCard('Typed into the wrong project');

      await command('work.log', { cardId, minutes: 60, workedOn: today() });
      await command('board.deleteCard', { cardId });

      expect(await testDatabase.database.selectFrom('workLog').select('id').execute()).toEqual([]);
    });
  });

  describe('WHEN a card is opened', () => {
    it('THEN the detail carries everything the panel shows', async () => {
      const cardId = await createCard('Harbour crane retopo', { type: 'art' });
      await command('board.updateCard', {
        cardId,
        description: 'Retopologise to the budget.',
        estimateMinutes: 150,
        priority: 'high',
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/q/board.cardDetail?cardId=${cardId}`,
        cookies: { lpm_session: ownerCookie },
      });
      const card = response.json<{ data: CardDetailView }>().data;

      expect(card).toMatchObject({
        cardKey: 'DRCH-ART-1',
        title: 'Harbour crane retopo',
        description: 'Retopologise to the budget.',
        estimateMinutes: 150,
        priority: 'high',
        listName: 'Backlog',
        projectSlug: 'drowned-reach',
        reporter: { displayName: 'Jake Winters' },
        assignee: null,
      });
    });

    it('THEN a card in another account is not found', async () => {
      const cardId = await createCard('Secret');
      const otherAccount = await testDatabase.database
        .insertInto('account')
        .values({ name: 'Other Studio', slug: 'other-studio' })
        .returning('id')
        .executeTakeFirstOrThrow();

      await testDatabase.database
        .updateTable('card')
        .set({ accountId: otherAccount.id })
        .where('id', '=', cardId)
        .execute();

      const response = await server.inject({
        method: 'GET',
        url: `/api/q/board.cardDetail?cardId=${cardId}`,
        cookies: { lpm_session: ownerCookie },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN the caller may not write', () => {
    it('THEN a viewer cannot create a card', async () => {
      await seedTeammate('viewer', 'viewer@northwind.test');

      const response = await command(
        'board.createCard',
        { projectId, listId: listId('Backlog'), title: 'Not allowed', type: 'task' },
        await signIn('viewer@northwind.test'),
      );

      expect(response.statusCode).toBe(403);
    });

    it('THEN a member who is not on the project cannot move its cards', async () => {
      const cardId = await createCard('Theirs');
      await seedTeammate('member', 'member@northwind.test');

      const response = await command(
        'board.moveCard',
        { cardId, toListId: listId('In progress') },
        await signIn('member@northwind.test'),
      );

      expect(response.statusCode).toBe(404);
    });

    it('THEN nobody can write to an archived project', async () => {
      const cardId = await createCard('Frozen');
      await command('projects.archive', { projectId });

      const response = await command('board.updateCard', { cardId, title: 'Changed' });

      expect(response.json()).toMatchObject({ code: 'INVARIANT_VIOLATED' });
    });

    it('THEN an anonymous caller is refused', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/c/board.createCard',
        payload: {
          commandId: nextCommandId(),
          projectId,
          listId: listId('Backlog'),
          title: 'Anonymous',
          type: 'task',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
