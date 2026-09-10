import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import {
  MAXIMUM_CARD_SUGGESTIONS,
  type BoardView,
  type CardDetailView,
  type WaitingMentionsView,
} from '@lpm/shared';
import type { FastifyInstance } from 'fastify';
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
  return `018f4444-0000-7000-8000-${String(commandCounter).padStart(12, '0')}`;
}

function readSessionCookie(cookies: readonly { name: string; value: string }[]): string {
  const cookie = cookies.find((candidate) => candidate.name === 'lpm_session');

  if (cookie === undefined) {
    throw new Error('Expected a session cookie to have been set.');
  }

  return cookie.value;
}

describe('GIVEN a board with lists and cards on it', () => {
  let testDatabase: TestDatabase;
  let server: FastifyInstance;
  let passwordHash: string;
  let accountId: string;
  let ownerCookie: string;
  let projectId: string;
  let boardId: string;
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

    const board = await testDatabase.database
      .selectFrom('board')
      .select('id')
      .where('projectId', '=', projectId)
      .executeTakeFirstOrThrow();

    boardId = board.id;
    lists = await testDatabase.database
      .selectFrom('list')
      .select(['id', 'name'])
      .orderBy('position')
      .execute();
  });

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

  async function createCard(title: string, list = 'Backlog'): Promise<string> {
    const response = await command('board.createCard', {
      projectId,
      listId: listId(list),
      title,
      type: 'task',
    });

    return response.json<{ id: string }>().id;
  }

  async function readBoard(): Promise<BoardView> {
    const response = await server.inject({
      method: 'GET',
      url: '/api/q/board.view?slug=drowned-reach',
      cookies: { lpm_session: ownerCookie },
    });

    return response.json<{ data: BoardView }>().data;
  }

  async function readCard(cardId: string): Promise<CardDetailView> {
    const response = await server.inject({
      method: 'GET',
      url: `/api/q/board.cardDetail?cardId=${cardId}`,
      cookies: { lpm_session: ownerCookie },
    });

    return response.json<{ data: CardDetailView }>().data;
  }

  describe('WHEN a list is added', () => {
    it('THEN it goes on the end, where a board is read to', async () => {
      await command('board.createList', { boardId, name: 'In outsourcing', color: '#cf9556' });

      const board = await readBoard();

      expect(board.lists.map((list) => list.name)).toEqual([
        'Backlog',
        'In progress',
        'Ready for review',
        'Done',
        'In outsourcing',
      ]);
    });

    it('THEN it carries its colour and limit', async () => {
      await command('board.createList', {
        boardId,
        name: 'In outsourcing',
        color: '#cf9556',
        wipLimit: 3,
      });

      const board = await readBoard();

      expect(board.lists.at(-1)).toMatchObject({ color: '#cf9556', wipLimit: 3 });
    });

    it('THEN a colour that is not a hex is refused', async () => {
      const response = await command('board.createList', {
        boardId,
        name: 'Bad colour',
        color: 'orange',
      });

      expect(response.statusCode).toBe(422);
    });

    it('THEN a board in another account is not found', async () => {
      const otherAccount = await testDatabase.database
        .insertInto('account')
        .values({ name: 'Other Studio', slug: 'other-studio' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const otherProject = await testDatabase.database
        .insertInto('project')
        .values({ accountId: otherAccount.id, name: 'Kiln', code: 'KILN', slug: 'kiln' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const otherBoard = await testDatabase.database
        .insertInto('board')
        .values({ projectId: otherProject.id })
        .returning('id')
        .executeTakeFirstOrThrow();

      const response = await command('board.createList', {
        boardId: otherBoard.id,
        name: 'Sneaky',
        color: '#adadad',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN a list is changed', () => {
    it('THEN only what was sent changes', async () => {
      await command('board.updateList', { listId: listId('Backlog'), name: 'Icebox' });

      const board = await readBoard();

      expect(board.lists[0]).toMatchObject({ name: 'Icebox', color: '#adadad' });
    });

    it('THEN a limit sent as null removes it', async () => {
      await command('board.updateList', { listId: listId('In progress'), wipLimit: null });

      const board = await readBoard();

      expect(board.lists[1]?.wipLimit).toBeNull();
    });

    it('THEN a list cannot flow into itself', async () => {
      const response = await command('board.updateList', {
        listId: listId('Backlog'),
        nextListId: listId('Backlog'),
      });

      expect(response.json()).toMatchObject({ code: 'INVARIANT_VIOLATED' });
    });

    it('THEN a change with nothing in it writes nothing', async () => {
      await command('board.updateList', { listId: listId('Backlog') });

      const events = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .where('name', '=', 'board.listUpdated')
        .execute();

      expect(events).toHaveLength(0);
    });
  });

  describe('WHEN a list is moved', () => {
    async function listNames(): Promise<string[]> {
      return (await readBoard()).lists.map((list) => list.name);
    }

    it('THEN it lands in front of the list it was dropped on', async () => {
      await command('board.moveList', {
        listId: listId('Done'),
        beforeListId: listId('In progress'),
        afterListId: listId('Backlog'),
      });

      expect(await listNames()).toEqual(['Backlog', 'Done', 'In progress', 'Ready for review']);
    });

    it('THEN one dropped at the front of the board goes first', async () => {
      await command('board.moveList', {
        listId: listId('Done'),
        beforeListId: listId('Backlog'),
        afterListId: null,
      });

      expect((await listNames())[0]).toBe('Done');
    });

    it('THEN one dropped at the end goes last', async () => {
      await command('board.moveList', {
        listId: listId('Backlog'),
        beforeListId: null,
        afterListId: listId('Done'),
      });

      expect((await listNames()).at(-1)).toBe('Backlog');
    });

    it('THEN neighbours that have since left the board put it on the end', async () => {
      const gone = '018f9999-0000-7000-8000-000000000001';

      await command('board.moveList', {
        listId: listId('Backlog'),
        beforeListId: gone,
        afterListId: gone,
      });

      expect((await listNames()).at(-1)).toBe('Backlog');
    });

    it('THEN a gap too small to halve is spread back out rather than refused', async () => {
      // What a great many drops between the same two columns would eventually
      // leave behind, arrived at directly.
      await testDatabase.database
        .updateTable('list')
        .set({ position: 2000.000000001 })
        .where('id', '=', listId('Ready for review'))
        .execute();

      await command('board.moveList', {
        listId: listId('Done'),
        beforeListId: listId('Ready for review'),
        afterListId: listId('In progress'),
      });

      expect(await listNames()).toEqual(['Backlog', 'In progress', 'Done', 'Ready for review']);
    });

    it('THEN the move is on the audit trail', async () => {
      await command('board.moveList', {
        listId: listId('Done'),
        beforeListId: listId('Backlog'),
        afterListId: null,
      });

      const events = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .where('name', '=', 'board.listMoved')
        .execute();

      expect(events).toHaveLength(1);
    });

    it('THEN a list that is not on any board this caller can see is not found', async () => {
      const response = await command('board.moveList', {
        listId: '018f9999-0000-7000-8000-000000000002',
        beforeListId: null,
        afterListId: null,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN a list is archived', () => {
    it('THEN an empty one goes quietly', async () => {
      await command('board.archiveList', { listId: listId('Done') });

      const board = await readBoard();

      expect(board.lists.map((list) => list.name)).not.toContain('Done');
    });

    it('THEN one with cards on it refuses until it is told where they go', async () => {
      await createCard('Still here');

      const response = await command('board.archiveList', { listId: listId('Backlog') });

      expect(response.json()).toMatchObject({ code: 'INVARIANT_VIOLATED' });
      expect((await readBoard()).lists.map((list) => list.name)).toContain('Backlog');
    });

    it('THEN naming a list moves the cards there rather than stranding them', async () => {
      await createCard('First');
      await createCard('Second');

      await command('board.archiveList', {
        listId: listId('Backlog'),
        moveCardsToListId: listId('In progress'),
      });

      const board = await readBoard();
      const inProgress = board.lists.find((list) => list.name === 'In progress');

      expect(board.lists.map((list) => list.name)).not.toContain('Backlog');
      expect(inProgress?.cards.map((card) => card.title)).toEqual(['First', 'Second']);
    });

    it('THEN the cards move even into a list at its limit', async () => {
      // Refusing here would leave them in a list nobody can see any more.
      for (let index = 0; index < 4; index++) {
        await createCard(`Review ${String(index)}`, 'Ready for review');
      }

      await createCard('Rescued');

      const response = await command('board.archiveList', {
        listId: listId('Backlog'),
        moveCardsToListId: listId('Ready for review'),
      });

      expect(response.json()).toMatchObject({ ok: true });
      expect((await readBoard()).lists[1]?.count).toBe(5);
    });

    it('THEN moving them into the list being archived is refused', async () => {
      await createCard('Circular');

      const response = await command('board.archiveList', {
        listId: listId('Backlog'),
        moveCardsToListId: listId('Backlog'),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN a card has steps on it', () => {
    let cardId: string;

    beforeEach(async () => {
      cardId = await createCard('Harbour crane retopo');
    });

    it('THEN they come back in the order they were added', async () => {
      await command('board.addSubtask', { cardId, title: 'Block out' });
      await command('board.addSubtask', { cardId, title: 'Retopologise' });
      await command('board.addSubtask', { cardId, title: 'Bake' });

      const card = await readCard(cardId);

      expect(card.subtasks.map((subtask) => subtask.title)).toEqual([
        'Block out',
        'Retopologise',
        'Bake',
      ]);
      expect(card.subtasks.every((subtask) => !subtask.done)).toBe(true);
    });

    it('THEN one can be ticked off and renamed by the same command', async () => {
      const added = await command('board.addSubtask', { cardId, title: 'Block out' });
      const subtaskId = added.json<{ id: string }>().id;

      await command('board.updateSubtask', { subtaskId, done: true, title: 'Blocked out' });

      const card = await readCard(cardId);

      expect(card.subtasks[0]).toMatchObject({ title: 'Blocked out', done: true });
    });

    it('THEN one can be removed', async () => {
      const added = await command('board.addSubtask', { cardId, title: 'Wrong' });

      await command('board.removeSubtask', { subtaskId: added.json<{ id: string }>().id });

      expect((await readCard(cardId)).subtasks).toHaveLength(0);
    });

    it('THEN a step on a card in another account is not found', async () => {
      const added = await command('board.addSubtask', { cardId, title: 'Private' });
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

      const response = await command('board.updateSubtask', {
        subtaskId: added.json<{ id: string }>().id,
        done: true,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN a comment names somebody', () => {
    async function waitingFor(cookie: string): Promise<WaitingMentionsView> {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/notifications.waiting',
        cookies: { lpm_session: cookie },
      });

      return response.json<{ data: WaitingMentionsView }>().data;
    }

    /** Somebody on the project, so a mention of them is one that may be told. */
    async function seedMember(email: string): Promise<{ userId: string; cookie: string }> {
      const userId = await seedTeammate('member', email);

      await command('projects.addMember', { projectId, userId });

      return { userId, cookie: await signIn(email) };
    }

    it('THEN it is waiting for them, with somewhere to go', async () => {
      const cardId = await createCard('Watchtower LOD1 pops');
      const mira = await seedMember('mira@northwind.test');

      await command('board.comment', {
        cardId,
        body: `@[Team Mate](user:${mira.userId}) the deck is wrong`,
      });

      const waiting = await waitingFor(mira.cookie);

      expect(waiting.total).toBe(1);
      expect(waiting.mentions[0]).toMatchObject({
        cardId,
        cardTitle: 'Watchtower LOD1 pops',
        said: { displayName: 'Jake Winters' },
        // Written out as the words the marks stand for: a panel is read rather
        // than pressed through, and the raw mark is not a sentence.
        excerpt: '@Team Mate the deck is wrong',
      });
    });

    it('THEN nobody else hears about it', async () => {
      const cardId = await createCard('Watchtower LOD1 pops');
      const mira = await seedMember('mira@northwind.test');
      const leo = await seedMember('leo@northwind.test');

      await command('board.comment', {
        cardId,
        body: `@[Team Mate](user:${mira.userId}) have a look`,
      });

      expect((await waitingFor(leo.cookie)).total).toBe(0);
    });

    it('THEN naming yourself tells you nothing', async () => {
      // People do it while writing, and a red circle for a sentence you have
      // just typed is a notification about your own hands.
      const cardId = await createCard('Watchtower LOD1 pops');
      const owner = await testDatabase.database
        .selectFrom('appUser')
        .select('id')
        .where('email', '=', OWNER_EMAIL)
        .executeTakeFirstOrThrow();

      await command('board.comment', {
        cardId,
        body: `@[Jake Winters](user:${owner.id}) note to self`,
      });

      expect((await waitingFor(ownerCookie)).total).toBe(0);
    });

    it('THEN somebody who cannot reach the project is not told', async () => {
      /*
       * The sentence still says their name — a comment is a record of what was
       * said — but being told about a card you cannot open is a notification
       * that leads to a page saying the thing does not exist.
       */
      const cardId = await createCard('Watchtower LOD1 pops');
      const outsider = await seedTeammate('member', 'outsider@northwind.test');
      const theirCookie = await signIn('outsider@northwind.test');

      await command('board.comment', {
        cardId,
        body: `@[Team Mate](user:${outsider}) look at this`,
      });

      const card = await readCard(cardId);

      expect((await waitingFor(theirCookie)).total).toBe(0);
      expect(card.comments[0]?.body).toContain(outsider);
    });

    it('THEN a lead is told, though a card could not be given to them', async () => {
      /*
       * The two rules diverge here on purpose, and this is the half that keeps
       * them apart.
       *
       * A lead makes the projects and can open every board, so a remark naming
       * them leads somewhere they can read — asking the studio head a question
       * about a card is a reasonable thing to do. Handing them the card is a
       * different act, and `cards.test.ts` refuses it.
       *
       * Merging the two would break one of them silently, in whichever
       * direction the merge went.
       */
      const cardId = await createCard('Watchtower LOD1 pops');
      const lead = await seedTeammate('lead', 'lead@northwind.test');
      const theirCookie = await signIn('lead@northwind.test');

      await command('board.comment', {
        cardId,
        body: `@[Team Mate](user:${lead}) can you look at this?`,
      });

      expect((await waitingFor(theirCookie)).total).toBe(1);
    });

    it('THEN the browser cannot decide who was named', async () => {
      // Read out of the body the server stored rather than out of anything the
      // caller claimed, so a comment naming nobody cannot light up a mark.
      const cardId = await createCard('Watchtower LOD1 pops');
      const mira = await seedMember('mira@northwind.test');

      await command('board.comment', {
        cardId,
        body: 'nothing to see here',
        mentioned: [mira.userId],
      });

      expect((await waitingFor(mira.cookie)).total).toBe(0);
    });

    it('THEN pressing it takes it off the mark, and only theirs', async () => {
      const cardId = await createCard('Watchtower LOD1 pops');
      const mira = await seedMember('mira@northwind.test');

      await command('board.comment', {
        cardId,
        body: `@[Team Mate](user:${mira.userId}) the deck is wrong`,
      });

      const waiting = await waitingFor(mira.cookie);
      const mentionId = waiting.mentions[0]?.id ?? '';

      // Somebody else's press does nothing to it: the update names the
      // session's own user, so the row is one it cannot reach.
      await command('notifications.see', { mentionId });
      expect((await waitingFor(mira.cookie)).total).toBe(1);

      await command('notifications.see', { mentionId }, mira.cookie);
      expect((await waitingFor(mira.cookie)).total).toBe(0);
    });

    it('THEN it goes quiet when they are taken off the project', async () => {
      /*
       * Reach is not for life. The mention was allowed when it was said, and a
       * week later the panel would be offering the key of a card that now
       * answers "no such thing".
       */
      const cardId = await createCard('Watchtower LOD1 pops');
      const mira = await seedMember('mira@northwind.test');

      await command('board.comment', {
        cardId,
        body: `@[Team Mate](user:${mira.userId}) the deck is wrong`,
      });

      expect((await waitingFor(mira.cookie)).total).toBe(1);

      await command('projects.removeMember', { projectId, userId: mira.userId });

      const gone = await waitingFor(mira.cookie);

      expect(gone.total).toBe(0);
      expect(gone.mentions).toHaveLength(0);
    });

    it('THEN it is waiting again if they are put back', async () => {
      // Quiet rather than deleted: nobody unsaid it.
      const cardId = await createCard('Watchtower LOD1 pops');
      const mira = await seedMember('mira@northwind.test');

      await command('board.comment', {
        cardId,
        body: `@[Team Mate](user:${mira.userId}) the deck is wrong`,
      });

      await command('projects.removeMember', { projectId, userId: mira.userId });
      await command('projects.addMember', { projectId, userId: mira.userId });

      expect((await waitingFor(mira.cookie)).total).toBe(1);
    });

    it('THEN a mention on a deleted comment stops waiting', async () => {
      // A mark pointing at a sentence nobody can read any more is a mark that
      // cannot be cleared by reading it.
      const cardId = await createCard('Watchtower LOD1 pops');
      const mira = await seedMember('mira@northwind.test');

      await command('board.comment', {
        cardId,
        body: `@[Team Mate](user:${mira.userId}) the deck is wrong`,
      });

      await testDatabase.database
        .updateTable('comment')
        .set({ deletedAt: new Date() })
        .where('cardId', '=', cardId)
        .execute();

      expect((await waitingFor(mira.cookie)).total).toBe(0);
    });
  });

  describe('WHEN somebody comments on a card', () => {
    it('THEN it appears with who said it and when', async () => {
      const cardId = await createCard('Watchtower LOD1 pops');

      await command('board.comment', { cardId, body: 'Reproduced on the ps5 devkit.' });

      const card = await readCard(cardId);

      expect(card.comments).toHaveLength(1);
      expect(card.comments[0]).toMatchObject({
        body: 'Reproduced on the ps5 devkit.',
        author: { displayName: 'Jake Winters' },
        editedAt: null,
      });
    });

    it('THEN what was said is not repeated into the outbox', async () => {
      const cardId = await createCard('Sensitive');

      await command('board.comment', { cardId, body: 'The publisher has not signed yet.' });

      const event = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .where('name', '=', 'board.commented')
        .executeTakeFirstOrThrow();

      expect(JSON.stringify(event.payload)).not.toContain('publisher');
    });

    it('THEN an empty comment is refused', async () => {
      const cardId = await createCard('Quiet');

      const response = await command('board.comment', { cardId, body: '   ' });

      expect(response.statusCode).toBe(422);
    });

    it('THEN a viewer cannot comment', async () => {
      const cardId = await createCard('Read only to them');
      await seedTeammate('viewer', 'viewer@northwind.test');

      const response = await command(
        'board.comment',
        { cardId, body: 'Can I?' },
        await signIn('viewer@northwind.test'),
      );

      expect(response.statusCode).toBe(403);
    });
  });

  describe('WHEN one card is linked to another', () => {
    let blocker: string;
    let blocked: string;

    beforeEach(async () => {
      blocker = await createCard('Rig share: quadruped base');
      blocked = await createCard('Leviathan phase-2 silhouette');
    });

    it('THEN both ends know about it', async () => {
      await command('board.linkCard', {
        cardId: blocker,
        toCardKey: 'DRCH-TASK-2',
        kind: 'blocks',
      });

      const fromBlocker = await readCard(blocker);
      const fromBlocked = await readCard(blocked);

      expect(fromBlocker.links).toEqual([
        expect.objectContaining({ kind: 'blocks', cardId: blocked }),
      ]);
      expect(fromBlocked.links).toEqual([
        expect.objectContaining({ kind: 'blocked_by', cardId: blocker }),
      ]);
    });

    it('THEN the link carries enough of the other card to draw a chip', async () => {
      await command('board.linkCard', {
        cardId: blocker,
        toCardKey: 'DRCH-TASK-2',
        kind: 'relates',
      });

      expect((await readCard(blocker)).links[0]).toMatchObject({
        cardKey: 'DRCH-TASK-2',
        title: 'Leviathan phase-2 silhouette',
        type: 'task',
        closed: false,
      });
    });

    it('THEN asking for the same link twice leaves one', async () => {
      await command('board.linkCard', {
        cardId: blocker,
        toCardKey: 'DRCH-TASK-2',
        kind: 'blocks',
      });
      const again = await command('board.linkCard', {
        cardId: blocker,
        toCardKey: 'DRCH-TASK-2',
        kind: 'blocks',
      });

      expect(again.json()).toMatchObject({ ok: true });
      expect((await readCard(blocker)).links).toHaveLength(1);
    });

    it('THEN a card cannot be linked to itself', async () => {
      const response = await command('board.linkCard', {
        cardId: blocker,
        toCardKey: 'DRCH-TASK-1',
        kind: 'blocks',
      });

      expect(response.json()).toMatchObject({ code: 'INVARIANT_VIOLATED' });
    });

    it('THEN removing it removes the other half too', async () => {
      await command('board.linkCard', {
        cardId: blocker,
        toCardKey: 'DRCH-TASK-2',
        kind: 'blocks',
      });
      const linkId = (await readCard(blocker)).links[0]?.id;

      await command('board.unlinkCard', { linkId });

      expect((await readCard(blocker)).links).toHaveLength(0);
      expect((await readCard(blocked)).links).toHaveLength(0);
    });

    it('THEN a link id that does not exist is not found', async () => {
      const response = await command('board.unlinkCard', {
        linkId: '018f0000-0000-7000-8000-00000000dead',
      });

      expect(response.statusCode).toBe(404);
    });

    it('THEN a key from another project is not found on this board', async () => {
      // A key is only unique within its project, so looking it up inside this
      // card's project is what keeps a link on one board.
      const other = await command('projects.create', { name: 'Kiln', code: 'KILN' });
      const otherProjectId = other.json<{ id: string }>().id;
      const otherList = await testDatabase.database
        .selectFrom('list')
        .innerJoin('board', 'board.id', 'list.boardId')
        .select('list.id as id')
        .where('board.projectId', '=', otherProjectId)
        .orderBy('list.position')
        .executeTakeFirstOrThrow();

      await command('board.createCard', {
        projectId: otherProjectId,
        listId: otherList.id,
        title: 'Elsewhere',
        type: 'task',
      });

      const response = await command('board.linkCard', {
        cardId: blocker,
        toCardKey: 'KILN-TASK-1',
        kind: 'relates',
      });

      expect(response.statusCode).toBe(404);
    });

    it('THEN a key nobody issued is not found', async () => {
      const response = await command('board.linkCard', {
        cardId: blocker,
        toCardKey: 'DRCH-TASK-999',
        kind: 'relates',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN somebody is looking for something to link to', () => {
    beforeEach(async () => {
      await createCard('Harbour crane retopo');
      await createCard('Harbour ambience bed');
      await createCard('Leviathan phase-2 silhouette');
    });

    interface Found {
      cards: { cardKey: string; title: string }[];
      assets: { assetKey: string; name: string; categoryName: string }[];
    }

    async function found(query: string): Promise<Found> {
      const response = await server.inject({
        method: 'GET',
        url: `/api/q/board.search?projectId=${projectId}&query=${encodeURIComponent(query)}`,
        cookies: { lpm_session: ownerCookie },
      });

      return response.json<{ data: Found }>().data;
    }

    async function search(query: string): Promise<{ cardKey: string; title: string }[]> {
      return (await found(query)).cards;
    }

    /** A library to find things in, beside the board. */
    async function addAsset(name: string): Promise<void> {
      const category = await command('assets.createCategory', {
        projectId,
        name: 'Environment Props',
        color: '#eda363',
      });

      await command('assets.createAsset', {
        projectId,
        categoryId: category.json<{ id: string }>().id,
        name,
      });
    }

    it('THEN part of a key finds the cards it belongs to', async () => {
      const found = await search('TASK-');

      expect(found.map((card) => card.cardKey)).toEqual([
        'DRCH-TASK-1',
        'DRCH-TASK-2',
        'DRCH-TASK-3',
      ]);
    });

    it('THEN part of a title finds it too, for a half-remembered key', async () => {
      const found = await search('harbour');

      expect(found.map((card) => card.title).sort()).toEqual([
        'Harbour ambience bed',
        'Harbour crane retopo',
      ]);
    });

    it('THEN it is not case sensitive', async () => {
      expect(await search('LEVIATHAN')).toHaveLength(1);
      expect(await search('drch-task-1')).toHaveLength(1);
    });

    it('THEN it offers no more than a list somebody would read', async () => {
      for (let index = 0; index < 12; index++) {
        await createCard(`Extra harbour ${String(index)}`);
      }

      expect((await search('harbour')).length).toBe(MAXIMUM_CARD_SUGGESTIONS);
    });

    it('THEN an asset comes back beside the cards, from the one search', async () => {
      await addAsset('Harbour crane');

      // A card is a piece of work and an asset is the thing the work is for.
      // Somebody typing `harbour` is reaching for one of them without having
      // decided which, and making them choose the box first is making them
      // answer a question about our data model.
      const both = await found('harbour');

      expect(both.cards.map((card) => card.title).sort()).toEqual([
        'Harbour ambience bed',
        'Harbour crane retopo',
      ]);
      expect(both.assets.map((asset) => asset.name)).toEqual(['Harbour crane']);
    });

    it('THEN an asset key finds it, as a card key finds a card', async () => {
      await addAsset('Harbour crane');

      const [asset] = (await found('AST-')).assets;

      expect(asset?.assetKey).toContain('AST-');
      expect(asset?.categoryName).toBe('Environment Props');
    });

    it('THEN a search matching only cards answers with no assets rather than nothing', async () => {
      await addAsset('Harbour crane');

      expect(await found('leviathan')).toMatchObject({ assets: [] });
    });

    it('THEN each kind is capped on its own, so a big board cannot crowd out a library', async () => {
      await addAsset('Harbour crane');

      for (let index = 0; index < 12; index++) {
        await createCard(`Extra harbour ${String(index)}`);
      }

      const both = await found('harbour');

      expect(both.cards).toHaveLength(MAXIMUM_CARD_SUGGESTIONS);
      expect(both.assets).toHaveLength(1);
    });

    it('THEN too short a search is refused rather than matching the board', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/q/board.search?projectId=${projectId}&query=ha`,
        cookies: { lpm_session: ownerCookie },
      });

      expect(response.statusCode).toBe(422);
    });

    it('THEN it never reaches another project', async () => {
      const other = await command('projects.create', { name: 'Kiln', code: 'KILN' });
      const otherProjectId = other.json<{ id: string }>().id;
      const otherList = await testDatabase.database
        .selectFrom('list')
        .innerJoin('board', 'board.id', 'list.boardId')
        .select('list.id as id')
        .where('board.projectId', '=', otherProjectId)
        .orderBy('list.position')
        .executeTakeFirstOrThrow();

      await command('board.createCard', {
        projectId: otherProjectId,
        listId: otherList.id,
        title: 'Harbour elsewhere',
        type: 'task',
      });

      expect((await search('harbour')).map((card) => card.title)).not.toContain(
        'Harbour elsewhere',
      );
    });
  });

  /**
   * A card that gathers other cards.
   *
   * The rules are what this is about: one level deep, one legend per card, and
   * a legend that lets go rather than refusing when it is unmade.
   */
  describe('WHEN a card is made a legend', () => {
    let legend: string;
    let bug: string;

    beforeEach(async () => {
      legend = await createCard('Harbour set pass');
      bug = await createCard('Crane clips through the dock');
    });

    it('THEN it says it is one, before anything is under it', async () => {
      await command('board.setLegend', { cardId: legend, isLegend: true });

      const read = await readCard(legend);

      // Findable as a legend while still empty, because a producer makes the
      // clump before filling it.
      expect(read.isLegend).toBe(true);
      expect(read.children).toEqual([]);
    });

    it('THEN a card put under it comes back on it, with the list it sits in', async () => {
      await command('board.setLegend', { cardId: legend, isLegend: true });
      await command('board.putUnderLegend', { cardId: bug, legendKey: 'DRCH-TASK-1' });

      expect((await readCard(legend)).children).toEqual([
        expect.objectContaining({
          cardKey: 'DRCH-TASK-2',
          title: 'Crane clips through the dock',
          listName: 'Backlog',
          closed: false,
        }),
      ]);
    });

    it('THEN the card under it says which legend it is in', async () => {
      await command('board.setLegend', { cardId: legend, isLegend: true });
      await command('board.putUnderLegend', { cardId: bug, legendKey: 'DRCH-TASK-1' });

      expect((await readCard(bug)).legend).toMatchObject({
        cardKey: 'DRCH-TASK-1',
        title: 'Harbour set pass',
      });
    });

    it('THEN a card that is not a legend cannot gather one', async () => {
      const response = await command('board.putUnderLegend', {
        cardId: bug,
        legendKey: 'DRCH-TASK-1',
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.json<{ message: string }>().message).toContain('not a legend');
    });

    it('THEN a card cannot be its own legend', async () => {
      await command('board.setLegend', { cardId: legend, isLegend: true });

      const response = await command('board.putUnderLegend', {
        cardId: legend,
        legendKey: 'DRCH-TASK-1',
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.json<{ message: string }>().message).toContain('its own legend');
    });

    it('THEN legends are one level deep', async () => {
      const second = await createCard('Dock lighting pass');

      await command('board.setLegend', { cardId: legend, isLegend: true });
      await command('board.setLegend', { cardId: second, isLegend: true });

      const response = await command('board.putUnderLegend', {
        cardId: second,
        legendKey: 'DRCH-TASK-1',
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.json<{ message: string }>().message).toContain('one level');
    });

    it('THEN a card under a legend cannot become one', async () => {
      await command('board.setLegend', { cardId: legend, isLegend: true });
      await command('board.putUnderLegend', { cardId: bug, legendKey: 'DRCH-TASK-1' });

      const response = await command('board.setLegend', { cardId: bug, isLegend: true });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.json<{ message: string }>().message).toContain('under a legend');
    });

    it('THEN taking a card out leaves the card and empties the legend', async () => {
      await command('board.setLegend', { cardId: legend, isLegend: true });
      await command('board.putUnderLegend', { cardId: bug, legendKey: 'DRCH-TASK-1' });
      await command('board.putUnderLegend', { cardId: bug, legendKey: null });

      expect((await readCard(legend)).children).toEqual([]);
      expect((await readCard(bug)).legend).toBeNull();
      // The card is still work. Only the grouping went.
      expect((await readCard(bug)).title).toBe('Crane clips through the dock');
    });

    it('THEN unmaking a legend lets its cards go rather than refusing', async () => {
      await command('board.setLegend', { cardId: legend, isLegend: true });
      await command('board.putUnderLegend', { cardId: bug, legendKey: 'DRCH-TASK-1' });

      const response = await command('board.setLegend', { cardId: legend, isLegend: false });

      expect(response.json()).toMatchObject({ ok: true });
      expect((await readCard(legend)).isLegend).toBe(false);
      // Orphaned, not deleted: they were always the real work.
      expect((await readCard(bug)).legend).toBeNull();
      expect((await readCard(bug)).title).toBe('Crane clips through the dock');
    });

    it('THEN a key from another board is not found', async () => {
      await command('board.setLegend', { cardId: legend, isLegend: true });

      const response = await command('board.putUnderLegend', {
        cardId: bug,
        legendKey: 'OTHER-TASK-1',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN a lead manages the board', () => {
    it('THEN they can add a list, and a member cannot', async () => {
      await seedTeammate('lead', 'lead@northwind.test');
      await seedTeammate('member', 'member@northwind.test');

      const byLead = await command(
        'board.createList',
        { boardId, name: 'Lead list', color: '#adadad' },
        await signIn('lead@northwind.test'),
      );
      const byMember = await command(
        'board.createList',
        { boardId, name: 'Member list', color: '#adadad' },
        await signIn('member@northwind.test'),
      );

      expect(byLead.json()).toMatchObject({ ok: true });
      expect(byMember.statusCode).toBe(403);
    });
  });
});
