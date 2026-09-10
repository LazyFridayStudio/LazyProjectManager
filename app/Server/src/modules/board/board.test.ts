import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import { MAXIMUM_CARDS_PER_LIST, type BoardView, type TaskListView } from '@lpm/shared';
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
  return `018f2222-0000-7000-8000-${String(commandCounter).padStart(12, '0')}`;
}

function postCommand(
  name: string,
  body: Record<string, unknown>,
  sessionCookie?: string,
): InjectOptions {
  return {
    method: 'POST',
    url: `/api/c/${name}`,
    payload: { commandId: nextCommandId(), ...body },
    ...(sessionCookie === undefined ? {} : { cookies: { lpm_session: sessionCookie } }),
  };
}

function readSessionCookie(cookies: readonly { name: string; value: string }[]): string {
  const cookie = cookies.find((candidate) => candidate.name === 'lpm_session');

  if (cookie === undefined) {
    throw new Error('Expected a session cookie to have been set.');
  }

  return cookie.value;
}

describe('GIVEN a project with a board', () => {
  let testDatabase: TestDatabase;
  let server: FastifyInstance;
  let passwordHash: string;
  let accountId: string;
  let ownerCookie: string;
  let projectId: string;

  const redis = createStubRedis();

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    passwordHash = await hashPassword(PASSWORD);

    // Built once, for the reason the other suites build theirs once: standing a
    // Fastify instance up is the most expensive thing in a per-test setup, and
    // nothing in it outlives a test once the database is empty again.
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

    const created = await server.inject(
      postCommand('projects.create', { name: 'Drowned Reach', code: 'DRCH' }, ownerCookie),
    );

    projectId = created.json<{ id: string }>().id;
  });

  async function signIn(email: string): Promise<string> {
    const response = await server.inject(
      postCommand('identity.signIn', { email, password: PASSWORD }),
    );

    return readSessionCookie(response.cookies);
  }

  async function seedTeammate(role: MembershipRole, email: string): Promise<string> {
    const user = await testDatabase.database
      .insertInto('appUser')
      .values({
        email,
        passwordHash,
        displayName: 'Team Mate',
        initials: 'TM',
        status: 'active',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await testDatabase.database
      .insertInto('membership')
      .values({ accountId, userId: user.id, role })
      .execute();

    return user.id;
  }

  async function firstListId(): Promise<string> {
    const list = await testDatabase.database
      .selectFrom('list')
      .select('id')
      .orderBy('position')
      .executeTakeFirstOrThrow();

    return list.id;
  }

  interface CardToSeed {
    readonly cardKey: string;
    readonly title?: string;
    readonly type?: 'art' | 'task' | 'bug' | 'build';
    readonly position: number;
    readonly listId?: string;
    readonly assigneeId?: string;
    readonly dueOn?: string;
    readonly points?: number;
    readonly closed?: boolean;
    readonly blocked?: boolean;
  }

  async function seedCard(card: CardToSeed): Promise<void> {
    await seedCards([card]);
  }

  /**
   * Puts cards straight into the table, in one statement.
   *
   * One statement rather than one each: the test that fills a list past its cap
   * seeds two hundred, and two hundred round trips took longer than every other
   * test in this file put together.
   */
  async function seedCards(cards: readonly CardToSeed[]): Promise<void> {
    if (cards.length === 0) {
      return;
    }

    const fallbackListId = await firstListId();

    await testDatabase.database
      .insertInto('card')
      .values(
        cards.map((card) => ({
          accountId,
          projectId,
          listId: card.listId ?? fallbackListId,
          cardKey: card.cardKey,
          title: card.title ?? card.cardKey,
          type: card.type ?? 'task',
          position: card.position,
          assigneeId: card.assigneeId ?? null,
          dueOn: card.dueOn ?? null,
          points: card.points ?? null,
          blocked: card.blocked ?? false,
          closedAt: card.closed === true ? new Date() : null,
        })),
      )
      .execute();
  }

  /** The id behind a seeded key, since `seedCards` chooses the keys and not the ids. */
  async function idOfCard(cardKey: string): Promise<string> {
    const card = await testDatabase.database
      .selectFrom('card')
      .select('id')
      .where('cardKey', '=', cardKey)
      .executeTakeFirstOrThrow();

    return card.id;
  }

  async function viewBoard(sessionCookie = ownerCookie, slug = 'drowned-reach') {
    return server.inject({
      method: 'GET',
      url: `/api/q/board.view?slug=${slug}`,
      cookies: { lpm_session: sessionCookie },
    });
  }

  async function readBoard(sessionCookie = ownerCookie): Promise<BoardView> {
    const response = await viewBoard(sessionCookie);

    return response.json<{ data: BoardView }>().data;
  }

  async function listTasks(sessionCookie = ownerCookie, slug = 'drowned-reach') {
    return server.inject({
      method: 'GET',
      url: `/api/q/board.taskList?slug=${slug}`,
      cookies: { lpm_session: sessionCookie },
    });
  }

  async function readTaskList(sessionCookie = ownerCookie): Promise<TaskListView> {
    return (await listTasks(sessionCookie)).json<{ data: TaskListView }>().data;
  }

  describe('WHEN a project has just been created', () => {
    it('THEN its board already has the four default lists, in order', async () => {
      const board = await readBoard();

      expect(board.lists.map((list) => list.name)).toEqual([
        'Backlog',
        'In progress',
        'Ready for review',
        'Done',
      ]);
    });

    it('THEN the lists carry their colours and work-in-progress limits', async () => {
      const board = await readBoard();

      expect(board.lists[0]).toMatchObject({ color: '#adadad', wipLimit: null, count: 0 });
      expect(board.lists[1]).toMatchObject({ color: '#f0de8a', wipLimit: 8 });
      expect(board.lists[2]).toMatchObject({ wipLimit: 4 });
    });

    it('THEN it carries enough of the project to draw the header', async () => {
      const board = await readBoard();

      expect(board.project).toMatchObject({
        name: 'Drowned Reach',
        code: 'DRCH',
        slug: 'drowned-reach',
        archived: false,
      });
      expect(board.boardId).toEqual(expect.any(String));
    });

    it('THEN its limits are rules, which is what the board says about a full list', async () => {
      const board = await readBoard();

      expect(board.project.wipIsAdvisory).toBe(false);
    });

    it('THEN every list is empty rather than missing', async () => {
      const board = await readBoard();

      expect(board.lists.every((list) => list.cards.length === 0)).toBe(true);
    });
  });

  describe('WHEN cards are on the board', () => {
    beforeEach(async () => {
      const listId = await firstListId();

      await seedCard({ cardKey: 'DRCH-ART-2', title: 'Second', position: 2000, listId });
      await seedCard({ cardKey: 'DRCH-ART-1', title: 'First', position: 1000, listId });
      await seedCard({ cardKey: 'DRCH-ART-3', title: 'Third', position: 3000, listId });
    });

    it('THEN a legend says it is one, and carries what is under it', async () => {
      await seedCards([
        { cardKey: 'DRCH-TASK-90', title: 'Harbour set pass', position: 90 },
        { cardKey: 'DRCH-BUG-91', title: 'Crane clips through the dock', position: 91 },
      ]);

      const legend = await idOfCard('DRCH-TASK-90');
      const bug = await idOfCard('DRCH-BUG-91');

      await testDatabase.database
        .updateTable('card')
        .set({ isLegend: true })
        .where('id', '=', legend)
        .execute();
      await testDatabase.database
        .updateTable('card')
        .set({ legendId: legend })
        .where('id', '=', bug)
        .execute();

      const chips = (await readBoard()).lists.flatMap((list) => list.cards);
      const gatherer = chips.find((chip) => chip.id === legend);

      // On the chip rather than fetched when the card is opened out: the board
      // draws a legend as a different card, and a spinner inside a card on a
      // board is a worse answer than the rows it is hiding.
      expect(gatherer?.isLegend).toBe(true);
      expect(gatherer?.gathers).toEqual([
        expect.objectContaining({ cardKey: 'DRCH-BUG-91', closed: false }),
      ]);

      // And every other card says it plainly, so the board can branch on it.
      expect(chips.find((chip) => chip.id === bug)?.isLegend).toBe(false);
      expect(chips.find((chip) => chip.id === bug)?.gathers).toEqual([]);
    });

    it('THEN they come back in position order, not insertion order', async () => {
      const board = await readBoard();

      expect(board.lists[0]?.cards.map((card) => card.title)).toEqual(['First', 'Second', 'Third']);
    });

    it('THEN the list counts what is on it', async () => {
      const board = await readBoard();

      expect(board.lists[0]?.count).toBe(3);
      expect(board.lists[1]?.count).toBe(0);
    });

    it('THEN a closed card is neither counted nor shown, anywhere but the end', async () => {
      await seedCard({ cardKey: 'DRCH-ART-4', title: 'Finished', position: 4000, closed: true });

      const board = await readBoard();

      expect(board.lists[0]?.count).toBe(3);
      expect(board.lists[0]?.cards.map((card) => card.title)).not.toContain('Finished');
    });

    it('THEN a closed card is drawn on the list the board finishes on, and marked', async () => {
      const board = await readBoard();
      const finishing = board.lists.at(-1);

      await seedCard({
        cardKey: 'DRCH-ART-5',
        title: 'Shipped',
        position: 5000,
        closed: true,
        listId: finishing?.id,
      });

      const after = await readBoard();
      const end = after.lists.at(-1);

      // Drawn, because closing a card in the column it was dropped in and then
      // hiding it there is indistinguishable from deleting it.
      expect(end?.cards.map((card) => card.title)).toContain('Shipped');
      expect(end?.cards.find((card) => card.title === 'Shipped')?.closed).toBe(true);

      // Counted as nothing, because the count is what is still to do.
      expect(end?.count).toBe(0);
    });

    it('THEN the whole board is read in one statement, whatever is on it', async () => {
      // The point of the lateral join, and the rule `API.md` sets. A query per
      // list is invisible on the four a new project has and is the entire cost
      // of the screen on thirty. Counted through a plugin, which Kysely calls
      // once per compiled query.
      let statements = 0;
      const counting = testDatabase.database.withPlugin({
        transformQuery: (args) => {
          statements += 1;
          return args.node;
        },
        transformResult: (args) => Promise.resolve(args.result),
      });

      const countingServer = await createServer({
        environment: testEnvironment,
        database: counting,
        redis: createStubRedis(),
        storage: createStubObjectStore(),
      });

      try {
        const response = await countingServer.inject({
          method: 'GET',
          url: '/api/q/board.view?slug=drowned-reach',
          cookies: { lpm_session: ownerCookie },
        });

        expect(response.statusCode).toBe(200);
        // The session behind the cookie, the caller's role, and the board. The
        // board is one of them however many lists and cards are on it.
        expect(statements).toBe(3);
      } finally {
        await countingServer.close();
      }
    });
  });

  describe('WHEN a card carries everything a chip can show', () => {
    beforeEach(async () => {
      const assigneeId = await seedTeammate('member', 'artist@northwind.test');

      await seedCard({
        cardKey: 'DRCH-BUG-1',
        title: 'Watchtower LOD1 pops at 30m',
        type: 'bug',
        position: 1000,
        assigneeId,
        dueOn: '2026-09-04',
        points: 2,
        blocked: true,
      });
    });

    it('THEN the chip carries it, and nothing the board would not draw', async () => {
      const board = await readBoard();
      const card = board.lists[0]?.cards[0];

      expect(card).toMatchObject({
        cardKey: 'DRCH-BUG-1',
        type: 'bug',
        title: 'Watchtower LOD1 pops at 30m',
        points: 2,
        dueOn: '2026-09-04',
        blocked: true,
        assignee: { displayName: 'Team Mate', initials: 'TM' },
      });
      // The description and acceptance criteria belong to the detail panel; a
      // board that carried them would carry them for every card on screen.
      expect(card).not.toHaveProperty('description');
    });

    it('THEN a due date is a calendar day, not an instant shifted by a timezone', async () => {
      const board = await readBoard();

      expect(board.lists[0]?.cards[0]?.dueOn).toBe('2026-09-04');
    });

    it('THEN an unassigned card says so rather than inventing a person', async () => {
      await seedCard({ cardKey: 'DRCH-BUILD-1', type: 'build', position: 2000 });

      const board = await readBoard();

      expect(board.lists[0]?.cards[1]?.assignee).toBeNull();
    });
  });

  describe('WHEN a list holds more cards than the board returns', () => {
    it('THEN it returns the cap and still counts the rest', async () => {
      const listId = await firstListId();
      const overflow = MAXIMUM_CARDS_PER_LIST + 5;

      await seedCards(
        Array.from({ length: overflow }, (_, index) => ({
          cardKey: `DRCH-TASK-${String(index)}`,
          position: index + 1,
          listId,
        })),
      );

      const board = await readBoard();

      expect(board.lists[0]?.cards).toHaveLength(MAXIMUM_CARDS_PER_LIST);
      expect(board.lists[0]?.count).toBe(overflow);
    });
  });

  describe('WHEN a list is archived', () => {
    it('THEN it leaves the board without taking its cards with it', async () => {
      const listId = await firstListId();
      await seedCard({ cardKey: 'DRCH-TASK-9', position: 1000, listId });

      await testDatabase.database
        .updateTable('list')
        .set({ archivedAt: new Date() })
        .where('id', '=', listId)
        .execute();

      const board = await readBoard();

      expect(board.lists.map((list) => list.name)).not.toContain('Backlog');
      const cards = await testDatabase.database.selectFrom('card').selectAll().execute();
      expect(cards).toHaveLength(1);
    });
  });

  describe("WHEN the project's work-in-progress limits are advice rather than rules", () => {
    beforeEach(async () => {
      await testDatabase.database
        .updateTable('project')
        .set({ wipIsAdvisory: true })
        .where('id', '=', projectId)
        .execute();
    });

    it('THEN the board is told, so it knows an over-limit drop is its to explain', async () => {
      const board = await readBoard();

      expect(board.project.wipIsAdvisory).toBe(true);
    });
  });

  describe('WHEN the caller may not see the project', () => {
    it('THEN a member who was never added to it is told it does not exist', async () => {
      await seedTeammate('member', 'member@northwind.test');

      const response = await viewBoard(await signIn('member@northwind.test'));

      expect(response.statusCode).toBe(404);
    });

    it('THEN a member who was added to it sees the board', async () => {
      const memberId = await seedTeammate('member', 'member@northwind.test');

      await testDatabase.database
        .insertInto('projectMember')
        .values({ projectId, userId: memberId, role: 'member' })
        .execute();

      const response = await viewBoard(await signIn('member@northwind.test'));

      expect(response.statusCode).toBe(200);
    });

    it('THEN a lead sees it without being added', async () => {
      await seedTeammate('lead', 'lead@northwind.test');

      const response = await viewBoard(await signIn('lead@northwind.test'));

      expect(response.statusCode).toBe(200);
    });

    it('THEN an outsourcer is refused, because their access is card by card', async () => {
      await seedTeammate('outsourcer', 'outsourcer@northwind.test');

      const response = await viewBoard(await signIn('outsourcer@northwind.test'));

      expect(response.statusCode).toBe(403);
    });

    it('THEN an anonymous caller is refused before the project is named', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/board.view?slug=drowned-reach',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('WHEN the board asked for does not exist', () => {
    it('THEN it answers not found', async () => {
      const response = await viewBoard(ownerCookie, 'nothing-here');

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN the project is archived', () => {
    it('THEN the board still opens, and says the project is archived', async () => {
      await server.inject(postCommand('projects.archive', { projectId }, ownerCookie));

      const board = await readBoard();

      expect(board.project.archived).toBe(true);
    });
  });

  describe('WHEN every task is asked for as a list', () => {
    it('THEN it holds the cards the board holds, in the same order', async () => {
      const lists = (await readBoard()).lists;

      await seedCards([
        { cardKey: 'DRCH-TASK-1', title: 'On the first list', position: 1000 },
        {
          cardKey: 'DRCH-TASK-2',
          title: 'On the second',
          position: 1000,
          listId: lists[1]?.id,
        },
      ]);

      const listed = await readTaskList();

      // Board order: down the first list, then down the second — which is the
      // board read left to right rather than the keys read in any order.
      expect(listed.rows.map((row) => row.title)).toEqual(['On the first list', 'On the second']);
      expect(listed.rows[0]?.listName).toBe('Backlog');
      expect(listed.rows[1]?.listName).toBe(lists[1]?.name);
    });

    it('THEN a closed card is listed and marked, where the board hides it', async () => {
      await seedCards([
        { cardKey: 'DRCH-TASK-1', title: 'Still going', position: 1000 },
        { cardKey: 'DRCH-TASK-2', title: 'Finished', position: 2000, closed: true },
      ]);

      const listed = await readTaskList();

      expect(listed.rows.map((row) => row.title)).toEqual(['Still going', 'Finished']);
      expect(listed.rows.find((row) => row.title === 'Finished')?.closed).toBe(true);
      // The board is the other half of the same fact.
      expect((await readBoard()).lists.flatMap((list) => list.cards)).toHaveLength(1);
    });

    it('THEN it carries what a chip has no room for', async () => {
      await seedCards([
        { cardKey: 'DRCH-TASK-1', title: 'Worth four points', position: 1000, points: 4 },
      ]);

      const row = (await readTaskList()).rows[0];

      expect(row?.points).toBe(4);
      expect(row?.cardKey).toBe('DRCH-TASK-1');
      expect(row?.listColor).not.toBe('');
    });

    it('THEN a project with no cards is a project with no rows, not a failure', async () => {
      const listed = await readTaskList();

      expect(listed.rows).toEqual([]);
      expect(listed.project.code).toBe('DRCH');
    });

    it('THEN it carries what the header needs, the way the board does', async () => {
      // The same header on both views: where a new card would go, and whether
      // there is a repository to read issues from.
      const listed = await readTaskList();

      expect(listed.lists.map((list) => list.name)).toEqual([
        'Backlog',
        'In progress',
        'Ready for review',
        'Done',
      ]);
      // No repository connected in this suite, which is its own answer rather
      // than a button that would fail on press.
      expect(listed.issues).toBeNull();
    });

    it('THEN a project in another account is not found', async () => {
      expect((await listTasks(ownerCookie, 'nothing-of-the-sort')).statusCode).toBe(404);
    });

    it('THEN somebody without a session is refused', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/board.taskList?slug=drowned-reach',
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
