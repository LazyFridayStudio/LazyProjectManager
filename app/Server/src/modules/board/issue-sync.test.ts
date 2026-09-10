import { generateKeyPairSync } from 'node:crypto';

import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import type { BoardView } from '@lpm/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createStubObjectStore } from '../../storage/index.js';
import { createStubRedis } from '../../testing/index.js';
import { createServer } from '../../server/create-server.js';
import { readEnvironment } from '../../server/environment.js';
import { hashPassword } from '../identity/password-hasher.js';
import { A_SYNC_CANNOT_RUN_LONGER_THAN_MS } from './sync/claim-the-sync.js';
import { createSyncAttempts, syncDueProjects } from './sync/sync-due-projects.js';

const PASSWORD = 'correct-horse-battery';
const OWNER_EMAIL = 'jake@northwind.test';
const REPO = 'northwind/saltmarsh';
const WEBHOOK_SECRET = 'wh_2f8c1a44d0e34b1fa9c7e5b06d1a83f4_long_enough';

const testEnvironment = readEnvironment({
  NODE_ENV: 'test',
  BASE_URL: 'http://localhost:24571',
  APP_SECRET: 'a key this test server was started with',
  DATABASE_URL: 'postgres://unused',
  REDIS_URL: 'redis://unused',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'unused',
  S3_ACCESS_KEY: 'unused',
  S3_SECRET_KEY: 'unused',
});

describe('GIVEN a project whose work is tracked as issues on a repository', () => {
  let testDatabase: TestDatabase;
  let server: FastifyInstance;
  let passwordHash: string;
  let ownerCookie: string;
  let projectId: string;
  let commandCount = 0;

  const redis = createStubRedis();

  /** What the forge says next. Reassigned per test. */
  let forge: (url: string, init?: RequestInit) => Promise<Response>;

  /** A key that will sign, so a token can be minted with it. */
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    passwordHash = await hashPassword(PASSWORD);
    server = await createServer({
      database: testDatabase.database,
      redis,
      storage: createStubObjectStore(),
      environment: testEnvironment,
      // Answered by the test rather than by GitHub: a suite that reached the
      // real forge would be a suite that fails when somebody is on a train.
      fetch: (url, init) => forge(url, init),
    });
    await server.ready();
  }, 60_000);

  afterAll(async () => {
    await server.close();
    await testDatabase.close();
  });

  beforeEach(async () => {
    await testDatabase.truncateAllTables();
    redis.forgetEverything();
    forge = () => Promise.reject(new Error('no forge answer was set up for this test'));
    asked = [];

    await seedInstall(testDatabase.database, {
      email: OWNER_EMAIL,
      passwordHash,
      displayName: 'Jake Winters',
    });

    ownerCookie = await signIn();
    projectId = (await command('projects.create', { name: 'Saltmarsh', code: 'SLTM' })).json<{
      id: string;
    }>().id;
  });

  function nextCommandId(): string {
    commandCount += 1;

    return `00000000-0000-4000-8000-${String(commandCount).padStart(12, '0')}`;
  }

  async function signIn(): Promise<string> {
    const response = await server.inject({
      method: 'POST',
      url: '/api/c/identity.signIn',
      payload: { commandId: nextCommandId(), email: OWNER_EMAIL, password: PASSWORD },
    });

    return response.cookies.find((each) => each.name === 'lpm_session')?.value ?? '';
  }

  async function command(
    name: string,
    body: Record<string, unknown>,
  ): Promise<Awaited<ReturnType<typeof server.inject>>> {
    return server.inject({
      method: 'POST',
      url: `/api/c/${name}`,
      payload: { commandId: nextCommandId(), ...body },
      cookies: { lpm_session: ownerCookie },
    });
  }

  async function board(): Promise<BoardView> {
    const response = await server.inject({
      method: 'GET',
      url: '/api/q/board.view?slug=saltmarsh',
      cookies: { lpm_session: ownerCookie },
    });

    return response.json<{ data: BoardView }>().data;
  }

  /** Every card on the board, with the list it is sitting in. */
  async function cardsOnBoard(): Promise<{ title: string; list: string; key: string }[]> {
    const view = await board();

    return view.lists.flatMap((list) =>
      list.cards.map((card) => ({ title: card.title, list: list.name, key: card.cardKey })),
    );
  }

  /** One issue as GitHub answers, trimmed to what is read. */
  function forgeIssue(fields: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 9001,
      number: 41,
      title: 'Crane winch clips through the deck',
      body: 'Only at the top of its travel.',
      state: 'open',
      // A forge always says when it last changed; the sync compares it against
      // the card to decide which side is right.
      updated_at: '2026-08-01T09:00:00Z',
      html_url: `https://github.com/${REPO}/issues/41`,
      labels: [],
      ...fields,
    };
  }

  /** Everything the forge was asked to do, in order. */
  let asked: { method: string; url: string; body: string }[] = [];

  /** Hands out a token, answers with these issues, and remembers what was asked. */
  function forgeHolding(
    issues: readonly Record<string, unknown>[],
    labels: readonly Record<string, unknown>[] = [],
  ) {
    return (url: string, init?: RequestInit): Promise<Response> => {
      asked.push({
        method: init?.method ?? 'GET',
        url,
        body: typeof init?.body === 'string' ? init.body : '',
      });

      if (url.includes('/access_tokens')) {
        return Promise.resolve(
          new Response(JSON.stringify({ token: 'ghs_secret', expires_at: '2030-01-01T00:00:00Z' })),
        );
      }

      if (url.includes('/labels')) {
        return Promise.resolve(new Response(JSON.stringify(labels)));
      }

      // A card raised as an issue: the forge answers with the issue it made,
      // which is what the card is then linked to.
      if (url.endsWith('/issues') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 7777,
              number: 77,
              html_url: `https://github.com/${REPO}/issues/77`,
            }),
          ),
        );
      }

      if (url.includes('/issues')) {
        return Promise.resolve(new Response(JSON.stringify(issues)));
      }

      return Promise.resolve(new Response(JSON.stringify({ full_name: REPO })));
    };
  }

  /** What was asked of the forge, without the token requests nobody is testing. */
  function askedOf(fragment: string): { method: string; url: string; body: string }[] {
    return asked.filter((each) => each.url.includes(fragment));
  }

  /** The one card on the board, for a test that has only made one. */
  async function onlyCardId(): Promise<string> {
    const [card] = (await board()).lists.flatMap((list) => list.cards);

    if (card === undefined) {
      throw new Error('Expected exactly one card on the board.');
    }

    return card.id;
  }

  /** The one thing in the bin, for a test that has only deleted one. */
  async function onlyBinnedId(): Promise<string> {
    const thing = await testDatabase.database
      .selectFrom('deletedThing')
      .select('id')
      .executeTakeFirstOrThrow();

    return thing.id;
  }

  async function connectRepository(withApp = true): Promise<void> {
    forge = forgeHolding([]);

    await command('scm.connect', {
      projectId,
      provider: 'github',
      repoFullName: REPO,
      webhookSecret: WEBHOOK_SECRET,
    });

    if (withApp) {
      await command('scm.connectApp', {
        projectId,
        appId: '412345',
        installationId: '98765',
        privateKey,
      });
    }
  }

  async function sync(): Promise<Awaited<ReturnType<typeof server.inject>>> {
    return command('board.syncIssues', { projectId });
  }

  /** How often this project's clock comes round, or null for not at all. */
  async function syncEvery(seconds: number | null): Promise<void> {
    await command('projects.update', { projectId, syncEverySeconds: seconds });
  }

  /** What the connection itself says about its own syncing. */
  async function connectionRow() {
    return testDatabase.database
      .selectFrom('scmConnection')
      .select(['syncingSince', 'syncFailedAt', 'syncFailure', 'issuesSyncedAt'])
      .executeTakeFirstOrThrow();
  }

  describe('WHEN there is nothing to read the repository with', () => {
    it('THEN a project with no repository is told to connect one', async () => {
      const response = await sync();

      expect(response.statusCode).toBe(422);
      expect(response.json<{ message: string }>().message).toContain('no repository connected');
    });

    it('THEN one connected for events only says what is missing', async () => {
      // Every Gitea and GitLab connection is in this state today: wired up to
      // hear from, with no credential to ask anything.
      await connectRepository(false);

      const response = await sync();

      expect(response.statusCode).toBe(422);
      expect(response.json<{ message: string }>().message).toContain('no app installed');
    });

    it('THEN the board offers no button, rather than one that fails on press', async () => {
      await connectRepository(false);

      expect((await board()).issues).toEqual({
        repoFullName: REPO,
        canRead: false,
        syncedAt: null,
        failingSince: null,
      });
    });

    it('THEN a project with no repository at all says nothing about one', async () => {
      expect((await board()).issues).toBeNull();
    });
  });

  describe('WHEN the repository has issues on it', () => {
    it('THEN an open one arrives as a card at the near end of the board', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);

      await sync();

      expect(await cardsOnBoard()).toEqual([
        {
          title: 'Crane winch clips through the deck',
          list: 'Backlog',
          key: 'SLTM-TASK-1',
        },
      ]);
    });

    it('THEN a closed one lands at the finished end rather than arriving and being moved', async () => {
      // The first sync of a repository with a year behind it should read as
      // that history, not as a hundred cards to work through.
      await connectRepository();
      forge = forgeHolding([forgeIssue({ state: 'closed' })]);

      await sync();

      expect((await cardsOnBoard())[0]?.list).toBe('Done');
    });

    it('THEN what it says is on the card', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);

      await sync();

      const card = (await board()).lists.flatMap((list) => list.cards)[0];
      const detail = await server.inject({
        method: 'GET',
        url: `/api/q/board.cardDetail?cardId=${card?.id ?? ''}`,
        cookies: { lpm_session: ownerCookie },
      });

      expect(detail.json<{ data: { description: string } }>().data.description).toBe(
        'Only at the top of its travel.',
      );
    });

    it('THEN one labelled a bug is a bug, and takes a bug key', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue({ labels: [{ name: 'Bug' }] })]);

      await sync();

      expect((await cardsOnBoard())[0]?.key).toBe('SLTM-BUG-1');
    });

    it('THEN a pull request is not one of them', async () => {
      // GitHub models a pull request as an issue with a `pull_request` on it,
      // so asking for issues asks for both.
      await connectRepository();
      forge = forgeHolding([
        forgeIssue(),
        forgeIssue({ id: 9002, number: 42, title: 'Retopologise the deck', pull_request: {} }),
      ]);

      await sync();

      expect(await cardsOnBoard()).toHaveLength(1);
    });

    it('THEN the oldest issue takes the lowest key, the way the numbers run', async () => {
      await connectRepository();
      forge = forgeHolding([
        // Newest first, which is the order the forge answers in.
        forgeIssue({ id: 9002, number: 42, title: 'Second' }),
        forgeIssue({ id: 9001, number: 41, title: 'First' }),
      ]);

      await sync();

      const cards = await cardsOnBoard();

      expect(cards.find((card) => card.title === 'First')?.key).toBe('SLTM-TASK-1');
      expect(cards.find((card) => card.title === 'Second')?.key).toBe('SLTM-TASK-2');
    });

    it('THEN the board says which repository it read, and when', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);

      await sync();

      const { issues } = await board();

      expect(issues?.canRead).toBe(true);
      expect(issues?.repoFullName).toBe(REPO);
      expect(issues?.syncedAt).not.toBeNull();
    });
  });

  describe('WHEN the same issues are read a second time', () => {
    it('THEN nothing doubles', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);

      await sync();
      await sync();

      expect(await cardsOnBoard()).toHaveLength(1);
    });

    it('THEN a title edited upstream arrives', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);
      await sync();

      forge = forgeHolding([forgeIssue({ title: 'Winch clips at full travel' })]);
      await sync();

      expect((await cardsOnBoard())[0]?.title).toBe('Winch clips at full travel');
    });

    it('THEN closing the issue moves its card to the far end of the board', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);
      await sync();

      forge = forgeHolding([forgeIssue({ state: 'closed' })]);
      await sync();

      expect((await cardsOnBoard())[0]?.list).toBe('Done');
    });

    it('THEN reopening it brings the card back out', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue({ state: 'closed' })]);
      await sync();

      forge = forgeHolding([forgeIssue({ state: 'open' })]);
      await sync();

      expect((await cardsOnBoard())[0]?.list).toBe('Backlog');
    });

    it('THEN a card somebody has dragged along stays where they put it', async () => {
      // Only closing moves a card. Dragging it back every sync would take the
      // board away from the people using it.
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);
      await sync();

      const view = await board();
      const card = view.lists.flatMap((list) => list.cards)[0];
      const inProgress = view.lists.find((list) => list.name === 'In progress');

      await command('board.moveCard', { cardId: card?.id, toListId: inProgress?.id });
      await sync();

      expect((await cardsOnBoard())[0]?.list).toBe('In progress');
    });

    it('THEN a card somebody deleted here is not made again', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);
      await sync();

      await command('board.deleteCard', { cardId: await onlyCardId() });

      forge = forgeHolding([forgeIssue()]);
      await sync();

      // The issue is still open on the repository and still arrives in the
      // answer. Making a card for it would undo the delete on a timer, which
      // is the one way a delete can be wrong without anybody doing anything.
      expect(await cardsOnBoard()).toEqual([]);
    });

    it('THEN putting that card back from the bin picks the issue up again', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);
      await sync();

      const cardId = await onlyCardId();
      await command('board.deleteCard', { cardId });
      await command('recovery.restore', { deletedThingId: await onlyBinnedId() });

      forge = forgeHolding([forgeIssue({ title: 'Winch clips at full travel' })]);
      await sync();

      // The card exists again, so the sync matches on it rather than reaching
      // the note that says the issue was turned down — one card, brought into
      // line, rather than a second one beside it.
      expect(await cardsOnBoard()).toEqual([
        { title: 'Winch clips at full travel', list: 'Backlog', key: 'SLTM-TASK-1' },
      ]);
      expect(await onlyCardId()).toBe(cardId);
    });

    it('THEN an issue the repository no longer has keeps its card', async () => {
      // It may still be work that happened here, and taking the card off the
      // board is worse than leaving one that has stopped being refreshed.
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);
      await sync();

      forge = forgeHolding([]);
      await sync();

      expect(await cardsOnBoard()).toHaveLength(1);
    });
  });

  describe('WHEN the board also holds cards somebody wrote', () => {
    it('THEN a sync leaves them exactly where they are', async () => {
      await connectRepository();
      const lists = (await board()).lists;
      const review = lists.find((list) => list.name === 'Ready for review');

      await command('board.createCard', {
        projectId,
        listId: review?.id,
        title: 'Light the harbour at dusk',
        type: 'art',
      });

      forge = forgeHolding([forgeIssue({ state: 'closed' })]);
      await sync();

      const mine = (await cardsOnBoard()).find((card) => card.title.startsWith('Light'));

      expect(mine?.list).toBe('Ready for review');
    });
  });

  describe('WHEN a card is written here', () => {
    /** The lists, so a card can be made in one and dragged to another. */
    async function lists(): Promise<{ id: string; name: string }[]> {
      return (await board()).lists.map((list) => ({ id: list.id, name: list.name }));
    }

    async function createCard(title: string, listName = 'Backlog'): Promise<string> {
      const list = (await lists()).find((each) => each.name === listName);
      const response = await command('board.createCard', {
        projectId,
        listId: list?.id,
        title,
        type: 'task',
      });

      return response.json<{ id: string }>().id;
    }

    it('THEN it is raised as an issue on the repository', async () => {
      await connectRepository();
      await createCard('Light the harbour at dusk');
      forge = forgeHolding([]);

      await sync();

      const raised = askedOf('/issues').find(
        (each) => each.method === 'POST' && !each.url.includes('/labels'),
      );

      expect(raised?.body).toContain('Light the harbour at dusk');
    });

    it('THEN the card remembers the issue, so a second sync does not raise it again', async () => {
      await connectRepository();
      await createCard('Light the harbour at dusk');
      forge = forgeHolding([]);
      await sync();

      asked = [];
      await sync();

      const raised = askedOf('/issues').filter(
        (each) => each.method === 'POST' && !each.url.includes('/labels'),
      );

      expect(raised).toEqual([]);
    });

    it('THEN a legend is not raised, because nobody works on a container', async () => {
      /*
       * A legend gathers the cards under it and says what the clump is called.
       * Nothing is closed by finishing one, so an issue for it would be a
       * ticket a repository cannot act on sitting beside the ones it can.
       */
      await connectRepository();

      const legend = await createCard('Harbour set: second pass');
      await command('board.setLegend', { cardId: legend, isLegend: true });

      forge = forgeHolding([]);

      await sync();

      const raised = askedOf('/issues').filter(
        (each) => each.method === 'POST' && !each.url.includes('/labels'),
      );

      expect(raised).toEqual([]);
    });

    it('THEN the cards gathered under a legend are raised like any other', async () => {
      // The work is the cards inside it. Only the container is left out.
      await connectRepository();

      const legend = await createCard('Harbour set: second pass');
      await command('board.setLegend', { cardId: legend, isLegend: true });

      const under = await createCard('Retopologise the deck');
      const legendKey = (await board()).lists
        .flatMap((list) => list.cards)
        .find((card) => card.id === legend)?.cardKey;

      await command('board.putUnderLegend', { cardId: under, legendKey });

      forge = forgeHolding([]);

      await sync();

      const raised = askedOf('/issues').filter(
        (each) => each.method === 'POST' && !each.url.includes('/labels'),
      );

      expect(raised).toHaveLength(1);
      expect(raised[0]?.body).toContain('Retopologise the deck');
    });

    it('THEN a card that was already there when the repository was connected is left alone', async () => {
      // Connecting a repository must not empty a studio's private board onto
      // somebody's issue tracker.
      const before = await createCard('Something we were already doing');

      await connectRepository();
      forge = forgeHolding([]);
      await sync();

      const raised = askedOf('/issues').filter((each) => each.method === 'POST');

      expect(raised).toEqual([]);
      expect(before).not.toBe('');
    });
  });

  describe('WHEN the same work changed on both sides', () => {
    /** An issue the forge says has not been touched since last August. */
    function oldIssue(fields: Record<string, unknown> = {}): Record<string, unknown> {
      return forgeIssue({ updated_at: '2026-08-01T09:00:00Z', ...fields });
    }

    async function cardFromIssue(): Promise<string> {
      await connectRepository();
      forge = forgeHolding([oldIssue()]);
      await sync();

      const view = await board();

      return view.lists.flatMap((list) => list.cards)[0]?.id ?? '';
    }

    it('THEN a title changed here since goes up to the issue', async () => {
      const cardId = await cardFromIssue();

      await command('board.updateCard', { cardId, title: 'Winch clips at full travel' });

      asked = [];
      forge = forgeHolding([oldIssue()]);
      await sync();

      const changed = askedOf('/issues/41').find((each) => each.method === 'PATCH');

      expect(changed?.body).toContain('Winch clips at full travel');
    });

    it('THEN a card dragged to the end of the board closes the issue', async () => {
      const cardId = await cardFromIssue();
      const done = (await board()).lists.at(-1);

      await command('board.moveCard', { cardId, toListId: done?.id });

      asked = [];
      forge = forgeHolding([oldIssue()]);
      await sync();

      const changed = askedOf('/issues/41').find((each) => each.method === 'PATCH');

      expect(changed?.body).toContain('"state":"closed"');
    });

    it('THEN dragging it back out reopens the issue', async () => {
      const cardId = await cardFromIssue();
      const view = await board();
      const done = view.lists.at(-1);
      const backlog = view.lists[0];

      await command('board.moveCard', { cardId, toListId: done?.id });
      forge = forgeHolding([oldIssue({ state: 'closed' })]);
      await sync();

      await command('board.moveCard', { cardId, toListId: backlog?.id });

      asked = [];
      forge = forgeHolding([oldIssue({ state: 'closed' })]);
      await sync();

      const changed = askedOf('/issues/41').find((each) => each.method === 'PATCH');

      expect(changed?.body).toContain('"state":"open"');
    });

    it('THEN an issue changed more recently than the card still wins', async () => {
      // The card was touched, but the forge says the issue was touched after
      // it — so the issue is the newer account of the same work.
      const cardId = await cardFromIssue();

      await command('board.updateCard', { cardId, title: 'Edited here first' });

      forge = forgeHolding([
        oldIssue({ title: 'Edited there second', updated_at: '2099-01-01T00:00:00Z' }),
      ]);
      await sync();

      expect((await cardsOnBoard())[0]?.title).toBe('Edited there second');
    });

    it('THEN a sync writing to a card does not make the board the newer side', async () => {
      // Otherwise the board would win every argument from the second sync
      // onwards, and an edit made on GitHub would never arrive again.
      await connectRepository();
      forge = forgeHolding([oldIssue()]);
      await sync();

      forge = forgeHolding([oldIssue({ title: 'Renamed upstream' })]);
      await sync();

      forge = forgeHolding([oldIssue({ title: 'Renamed upstream again' })]);
      await sync();

      expect((await cardsOnBoard())[0]?.title).toBe('Renamed upstream again');
    });
  });

  describe('WHEN the board says where the work is up to', () => {
    it('THEN the issue is labelled with the list its card is on', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);

      await sync();

      const added = askedOf('/issues/41/labels').find((each) => each.method === 'POST');

      expect(added?.body).toBe(JSON.stringify({ labels: ['Backlog'] }));
    });

    it('THEN a label the repository has never seen is created first, in the list colour', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);

      await sync();

      const created = askedOf('/labels').find((each) => each.method === 'POST');

      // The colour of the Backlog list, without the hash the forge does not want.
      expect(created?.body).toBe(JSON.stringify({ name: 'Backlog', color: 'adadad' }));
    });

    it('THEN a label the repository already has is not created again', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()], [{ name: 'Backlog' }]);

      await sync();

      const created = askedOf('/labels').filter(
        (each) => each.method === 'POST' && !each.url.includes('/issues/'),
      );

      expect(created).toEqual([]);
    });

    it('THEN closing an issue takes the old list off and puts the new one on', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);
      await sync();

      asked = [];
      forge = forgeHolding([forgeIssue({ state: 'closed', labels: [{ name: 'Backlog' }] })]);
      await sync();

      const removed = askedOf('/issues/41/labels/Backlog').find((each) => each.method === 'DELETE');
      const added = askedOf('/issues/41/labels').find((each) => each.method === 'POST');

      expect(removed).toBeDefined();
      expect(added?.body).toBe(JSON.stringify({ labels: ['Done'] }));
    });

    it('THEN an issue already wearing the right label is not asked about at all', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue({ labels: [{ name: 'Backlog' }] })]);

      await sync();

      // Not a single label request: a sync that changes nothing should cost
      // nothing on the other end.
      expect(askedOf('/labels')).toEqual([]);
    });

    it('THEN a label the studio put there is left alone', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue({ labels: [{ name: 'needs art' }] })]);

      await sync();

      expect(askedOf('needs%20art')).toEqual([]);
      expect(askedOf('needs art')).toEqual([]);
    });

    it('THEN an app that may read issues but not write them says so', async () => {
      await connectRepository();
      forge = (url, init) => {
        asked.push({ method: init?.method ?? 'GET', url, body: '' });

        if (url.includes('/access_tokens')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ token: 'ghs_secret', expires_at: '2030-01-01T00:00:00Z' }),
            ),
          );
        }

        if (url.includes('/labels')) {
          return Promise.resolve(new Response('{}', { status: 403 }));
        }

        return Promise.resolve(new Response(JSON.stringify([forgeIssue()])));
      };

      const response = await sync();

      expect(response.statusCode).toBe(422);
      expect(response.json<{ message: string }>().message).toContain('write access to issues');
    });

    it('THEN a forge that refuses the labels does not cost anybody their cards', async () => {
      // The board is written and committed before a single label goes out, so
      // the half that worked is kept and the next press finishes the rest.
      await connectRepository();
      forge = (url) => {
        if (url.includes('/access_tokens')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ token: 'ghs_secret', expires_at: '2030-01-01T00:00:00Z' }),
            ),
          );
        }

        if (url.includes('/labels')) {
          return Promise.resolve(new Response('{}', { status: 403 }));
        }

        return Promise.resolve(new Response(JSON.stringify([forgeIssue()])));
      };

      expect((await sync()).statusCode).toBe(422);
      expect((await cardsOnBoard())[0]?.title).toBe('Crane winch clips through the deck');
    });
  });

  describe('WHEN the project asks for open issues only', () => {
    async function askOnlyForOpen(): Promise<void> {
      await testDatabase.database
        .updateTable('project')
        .set({ syncOpenIssuesOnly: true })
        .execute();
    }

    /** The issue pages the forge was asked for, in order. */
    function issuePagesAsked(): string[] {
      return asked
        .filter((call) => call.url.includes('/issues?'))
        .map((call) => call.url.slice(call.url.indexOf('/issues?')));
    }

    it('THEN the hundred is spent on open issues rather than on closed history', async () => {
      await connectRepository();
      await askOnlyForOpen();
      forge = forgeHolding([forgeIssue()]);

      await sync();

      // Nothing is linked yet, so there is nothing to settle and no reason to
      // ask for closed issues at all.
      expect(issuePagesAsked()).toHaveLength(1);
      expect(issuePagesAsked()[0]).toContain('state=open');
    });

    it('THEN a closed issue nothing has seen does not arrive as a card', async () => {
      await connectRepository();
      await askOnlyForOpen();
      forge = forgeHolding([forgeIssue({ id: 9002, number: 42, state: 'closed' })]);

      await sync();

      // History arriving as cards is the whole of what this was turned on to
      // stop.
      expect(await cardsOnBoard()).toHaveLength(0);
    });

    it('THEN a card already standing for an issue still closes when that issue does', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);
      await sync();
      expect(await cardsOnBoard()).toHaveLength(1);

      // Now the setting goes on, and the issue it made that card from closes.
      await askOnlyForOpen();
      asked = [];
      forge = forgeHolding([forgeIssue({ state: 'closed', updated_at: '2026-09-01T09:00:00Z' })]);

      await sync();

      // Two requests: the open page for what becomes a card, and a closed page
      // since the last reconcile so a linked card is not stranded.
      const pages = issuePagesAsked();
      expect(pages).toHaveLength(2);
      expect(pages[0]).toContain('state=open');
      expect(pages[1]).toContain('state=closed');
      expect(pages[1]).toContain('since=');

      const [card] = await cardsOnBoard();
      expect(card?.list).toBe('Done');
    });

    it('THEN nothing changes for a project that has not asked', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue({ state: 'closed' })]);

      await sync();

      // One request, everything in it, and a closed issue lands finished — the
      // behaviour every project has until somebody turns this on.
      expect(issuePagesAsked()).toHaveLength(1);
      expect(issuePagesAsked()[0]).toContain('state=all');
      expect(await cardsOnBoard()).toHaveLength(1);
    });
  });

  describe('WHEN nobody presses anything', () => {
    /*
     * The real clock, read inside each test rather than once for the file.
     *
     * The sync stamps the connection with its own `new Date()`, so a fixed date
     * would be comparing a made-up now against a real one — and a date read at
     * collection time is already minutes stale by the time these run.
     */

    function everythingDue(now: Date, attempts = createSyncAttempts()) {
      return syncDueProjects({
        database: testDatabase.database,
        environment: { APP_SECRET: testEnvironment.APP_SECRET },
        fetch: (url, init) => forge(url, init),
        now,
        attempts,
      });
    }

    it('THEN a repository that has never been read is read', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);

      expect(await everythingDue(new Date())).toBe(1);
      expect(await cardsOnBoard()).toHaveLength(1);
    });

    it('THEN one read a moment ago is left alone', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);
      await everythingDue(new Date());

      expect(await everythingDue(new Date())).toBe(0);
    });

    it('THEN it comes round again a minute later, which is what a new project is set to', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);
      await everythingDue(new Date());

      const later = new Date(Date.now() + 61_000);

      expect(await everythingDue(later)).toBe(1);
    });

    it('THEN a project set to every half hour is left alone for half an hour', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);
      await everythingDue(new Date());
      await syncEvery(1800);

      expect(await everythingDue(new Date(Date.now() + 61_000))).toBe(0);
      expect(await everythingDue(new Date(Date.now() + 1801_000))).toBe(1);
    });

    it('THEN a project with the clock off is never due, however long it has been', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);
      await everythingDue(new Date());
      await syncEvery(null);

      expect(await everythingDue(new Date(Date.now() + 86_400_000))).toBe(0);
    });

    it('THEN the clock being off does not stop the forge saying there is something to read', async () => {
      // Off is the clock and only the clock. A merge that closes an issue still
      // reaches the board, which is what stops Off reading as "disconnected".
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);
      await everythingDue(new Date());
      await syncEvery(null);

      await testDatabase.database
        .updateTable('scmConnection')
        .set({ forgeSpokeAt: new Date() })
        .execute();

      expect(await everythingDue(new Date())).toBe(1);
    });

    it('THEN one the forge has spoken to since is due now, not on the clock', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);
      await everythingDue(new Date());

      // Read a moment ago, so the clock says leave it alone.
      expect(await everythingDue(new Date())).toBe(0);

      // A delivery arrives — a merge that closed an issue, say — and stamps the
      // connection. What it meant is still the sync's to work out; this only
      // says there is something to catch up with.
      await testDatabase.database
        .updateTable('scmConnection')
        .set({ forgeSpokeAt: new Date() })
        .execute();

      expect(await everythingDue(new Date())).toBe(1);
    });

    it('THEN it is left alone again once that has been caught up with', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);
      await testDatabase.database
        .updateTable('scmConnection')
        .set({ forgeSpokeAt: new Date() })
        .execute();

      expect(await everythingDue(new Date())).toBe(1);

      // The reconcile moved `issuesSyncedAt` past it, which is what clears the
      // condition — nothing has to remember to unset a flag.
      expect(await everythingDue(new Date())).toBe(0);
    });

    it('THEN a connection nothing has said anything about waits for the clock', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);
      await everythingDue(new Date());

      // Null means nothing outstanding, which is every connection until a
      // delivery arrives — and must not read as "due".
      expect(await everythingDue(new Date())).toBe(0);
    });

    it('THEN a connection with no credentials is never asked', async () => {
      // Every Gitea and GitLab connection is in this state, and asking every
      // minute would be a log full of the same refusal.
      await connectRepository(false);

      expect(await everythingDue(new Date())).toBe(0);
    });

    it('THEN a connection somebody else is already syncing is left to them', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);

      // What the button holds while it works, and what a second worker finds.
      await testDatabase.database
        .updateTable('scmConnection')
        .set({ syncingSince: new Date() })
        .execute();

      expect(await everythingDue(new Date())).toBe(0);
    });

    it('THEN a claim left behind by a worker that died is taken over', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);

      // Older than any sync could be, which is the whole of how a killed worker
      // is told from a busy one.
      await testDatabase.database
        .updateTable('scmConnection')
        .set({ syncingSince: new Date(Date.now() - A_SYNC_CANNOT_RUN_LONGER_THAN_MS - 1000) })
        .execute();

      expect(await everythingDue(new Date())).toBe(1);
    });

    it('THEN a claim taken to sync is given back afterwards', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);

      await everythingDue(new Date());

      expect(await connectionRow()).toMatchObject({ syncingSince: null });
    });

    it('THEN one that refused is left alone for a few minutes rather than asked again', async () => {
      await connectRepository();
      forge = () => Promise.resolve(new Response('{}', { status: 500 }));

      const attempts = createSyncAttempts();
      const now = new Date();

      expect(await everythingDue(now, attempts)).toBe(1);

      // A minute later it is still due by the clock, and still skipped.
      expect(await everythingDue(new Date(now.getTime() + 60_000), attempts)).toBe(0);
    });
  });

  describe('WHEN a sync fails', () => {
    /** A forge that mints a token and then refuses to be read. */
    function aForgeThatRefuses(): typeof forge {
      return (url) =>
        Promise.resolve(
          url.includes('/access_tokens')
            ? new Response(
                JSON.stringify({ token: 'ghs_secret', expires_at: '2030-01-01T00:00:00Z' }),
              )
            : new Response('{}', { status: 403 }),
        );
    }

    it('THEN the connection says so, rather than only the log', async () => {
      await connectRepository();
      forge = aForgeThatRefuses();

      await sync();

      const row = await connectionRow();

      expect(row.syncFailedAt).not.toBeNull();
      expect(row.syncFailure).toContain('read issues');
    });

    it('THEN the connection is given back, so the next sync can have it', async () => {
      await connectRepository();
      forge = aForgeThatRefuses();

      await sync();

      expect(await connectionRow()).toMatchObject({ syncingSince: null });
    });

    it('THEN how long it has been failing is kept, not restarted by every attempt', async () => {
      await connectRepository();
      forge = aForgeThatRefuses();

      await sync();
      const first = (await connectionRow()).syncFailedAt;

      await sync();

      expect((await connectionRow()).syncFailedAt).toEqual(first);
    });

    it('THEN a sync that works afterwards clears it', async () => {
      await connectRepository();
      forge = aForgeThatRefuses();
      await sync();

      forge = forgeHolding([forgeIssue()]);
      await sync();

      expect(await connectionRow()).toMatchObject({ syncFailedAt: null, syncFailure: null });
    });

    it('THEN a failure nothing wrote for a person to read is not put on the screen', async () => {
      await connectRepository();
      // Not a domain error: whatever this says could carry a connection string
      // or a fragment of SQL, and the column it would land in is shown.
      forge = () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.4:5432'));

      await sync();

      expect((await connectionRow()).syncFailure).not.toContain('10.0.0.4');
    });
  });

  describe('WHEN a sync is already running', () => {
    it('THEN the button says so rather than starting a second one', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);

      await testDatabase.database
        .updateTable('scmConnection')
        .set({ syncingSince: new Date() })
        .execute();

      const response = await sync();

      expect(response.statusCode).toBe(422);
      expect(response.json<{ message: string }>().message).toContain('already running');
    });

    it('THEN being refused is not recorded against the connection as a failure', async () => {
      await connectRepository();
      forge = forgeHolding([forgeIssue()]);
      const heldSince = new Date();

      await testDatabase.database
        .updateTable('scmConnection')
        .set({ syncingSince: heldSince })
        .execute();

      await sync();

      // The claim is still the other sync's, and nothing has been written down
      // about a failure that did not happen.
      const row = await connectionRow();

      expect(row.syncFailedAt).toBeNull();
      expect(row.syncingSince).toEqual(heldSince);
    });
  });

  describe('WHEN the forge refuses', () => {
    it('THEN the message says which permission is missing rather than a status code', async () => {
      await connectRepository();
      forge = (url) =>
        Promise.resolve(
          url.includes('/access_tokens')
            ? new Response(
                JSON.stringify({ token: 'ghs_secret', expires_at: '2030-01-01T00:00:00Z' }),
              )
            : new Response('{}', { status: 403 }),
        );

      const response = await sync();

      expect(response.statusCode).toBe(422);
      expect(response.json<{ message: string }>().message).toContain('read issues');
    });

    it('THEN a repository the installation does not cover says so', async () => {
      await connectRepository();
      forge = (url) =>
        Promise.resolve(
          url.includes('/access_tokens')
            ? new Response(
                JSON.stringify({ token: 'ghs_secret', expires_at: '2030-01-01T00:00:00Z' }),
              )
            : new Response('{}', { status: 404 }),
        );

      const response = await sync();

      expect(response.json<{ message: string }>().message).toContain('installation covers');
    });

    it('THEN anything else names the status, so it can be looked up', async () => {
      await connectRepository();
      forge = (url) =>
        Promise.resolve(
          url.includes('/access_tokens')
            ? new Response(
                JSON.stringify({ token: 'ghs_secret', expires_at: '2030-01-01T00:00:00Z' }),
              )
            : new Response('{}', { status: 500 }),
        );

      expect((await sync()).json<{ message: string }>().message).toContain('500');
    });
  });
});
