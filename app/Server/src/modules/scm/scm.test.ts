import { generateKeyPairSync } from 'node:crypto';
import { createHmac } from 'node:crypto';

import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import type { CardDetailView, ScmConnection } from '@lpm/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ingestScmDeliveries } from './ingest/ingest-deliveries.js';
import { createStubRedis } from '../../testing/index.js';
import { createServer } from '../../server/create-server.js';
import { readEnvironment } from '../../server/environment.js';
import { createStubObjectStore } from '../../storage/index.js';
import { hashPassword } from '../identity/password-hasher.js';

const PASSWORD = 'correct-horse-battery';
const OWNER_EMAIL = 'jake@northwind.test';

const WEBHOOK_SECRET = 'wh_2f8c1a44d0e34b1fa9c7e5b06d1a83f4_long_enough';
const REPO = 'northwind/saltmarsh';

const testEnvironment = readEnvironment({
  NODE_ENV: 'test',
  BASE_URL: 'http://localhost:24571',
  APP_SECRET: 'a key this test server was started with',
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
  return `018f7777-0000-7000-8000-${String(commandCounter).padStart(12, '0')}`;
}

function readSessionCookie(cookies: readonly { name: string; value: string }[]): string {
  const cookie = cookies.find((candidate) => candidate.name === 'lpm_session');

  if (cookie === undefined) {
    throw new Error('Expected a session cookie to have been set.');
  }

  return cookie.value;
}

describe('GIVEN a project whose work lands in a repository', () => {
  let testDatabase: TestDatabase;
  let server: FastifyInstance;
  let ownerCookie: string;
  let passwordHash: string;
  let projectId: string;
  let cardId: string;

  const redis = createStubRedis();

  /** What the forge says next. Reassigned per test. */
  let forge: (url: string, init?: RequestInit) => Promise<Response>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    passwordHash = await hashPassword(PASSWORD);

    // Built once: the forge is reached through a closure over `forge`, so a
    // test can change what it answers without a new server behind it.
    server = await createServer({
      environment: testEnvironment,
      database: testDatabase.database,
      redis,
      storage: createStubObjectStore(),
      // Answered by the test rather than by GitHub. A suite that reached the
      // real forge would be a suite that fails when somebody is on a train.
      fetch: (url, init) => forge(url, init),
    });
  });

  afterAll(async () => {
    await server.close();
    await testDatabase.close();
  });

  beforeEach(async () => {
    await testDatabase.truncateAllTables();
    redis.forgetEverything();

    forge = () => Promise.reject(new Error('no forge answer was set up for this test'));

    await seedInstall(testDatabase.database, {
      email: OWNER_EMAIL,
      passwordHash,
      displayName: 'Jake Winters',
    });

    ownerCookie = readSessionCookie(
      (
        await server.inject({
          method: 'POST',
          url: '/api/c/identity.signIn',
          payload: { commandId: nextCommandId(), email: OWNER_EMAIL, password: PASSWORD },
        })
      ).cookies,
    );

    projectId = (await command('projects.create', { name: 'Saltmarsh', code: 'SLTM' })).json<{
      id: string;
    }>().id;

    const list = await testDatabase.database
      .selectFrom('list')
      .select('id')
      .orderBy('position')
      .executeTakeFirstOrThrow();

    cardId = (
      await command('board.createCard', {
        projectId,
        listId: list.id,
        title: 'Harbour crane retopo',
        type: 'art',
      })
    ).json<{ id: string }>().id;
  });

  async function readCard(): Promise<CardDetailView> {
    const response = await server.inject({
      method: 'GET',
      url: `/api/q/board.cardDetail?cardId=${cardId}`,
      cookies: { lpm_session: ownerCookie },
    });

    return response.json<{ data: CardDetailView }>().data;
  }

  /** A push naming whatever the caller wants it to name. */
  function pushNaming(message: string, branch = 'main'): Record<string, unknown> {
    return {
      ref: `refs/heads/${branch}`,
      compare: 'https://example.test/compare/aaa...bbb',
      pusher: { name: 'jake' },
      commits: [
        {
          id: '1c8b04e7d92a536f0b8e41a7c25d93f60a4b8e17',
          message,
          url: 'https://example.test/commit/1c8b04e',
          timestamp: '2026-08-19T09:00:00Z',
          author: { name: 'Jake Winters' },
        },
      ],
    };
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

  async function connect(
    body: Record<string, unknown> = {},
  ): Promise<Awaited<ReturnType<typeof server.inject>>> {
    return command('scm.connect', {
      projectId,
      provider: 'github',
      repoFullName: REPO,
      webhookSecret: WEBHOOK_SECRET,
      ...body,
    });
  }

  async function readConnection(): Promise<ScmConnection | null> {
    const response = await server.inject({
      method: 'GET',
      url: `/api/q/scm.connection?projectId=${projectId}`,
      cookies: { lpm_session: ownerCookie },
    });

    return response.json<{ data: { connection: ScmConnection | null } }>().data.connection;
  }

  /** The path the provider was told to post to, taken from the settings screen. */
  async function webhookPath(): Promise<string> {
    const connection = await readConnection();

    return new URL(connection?.webhookUrl ?? '').pathname;
  }

  async function deliver(options: {
    path?: string;
    body?: Record<string, unknown>;
    secret?: string;
    deliveryId?: string;
    headers?: Record<string, string>;
  }): Promise<Awaited<ReturnType<typeof server.inject>>> {
    const payload = JSON.stringify(options.body ?? { ref: 'refs/heads/main' });
    const signature = createHmac('sha256', options.secret ?? WEBHOOK_SECRET)
      .update(Buffer.from(payload, 'utf8'))
      .digest('hex');

    return server.inject({
      method: 'POST',
      url: options.path ?? (await webhookPath()),
      payload,
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-github-delivery': options.deliveryId ?? `delivery-${String(commandCounter)}`,
        'x-hub-signature-256': `sha256=${signature}`,
        ...options.headers,
      },
    });
  }

  describe('WHEN nobody has connected one', () => {
    it('THEN the settings screen is told there is none, rather than being refused', async () => {
      expect(await readConnection()).toBeNull();
    });
  });

  describe('WHEN a repository is connected', () => {
    it('THEN the settings screen can say where the work lands', async () => {
      await connect();

      const connection = await readConnection();

      expect(connection?.repoFullName).toBe(REPO);
      expect(connection?.provider).toBe('github');
      expect(connection?.lastEventAt).toBeNull();
      expect(connection?.eventsReceived).toBe(0);
    });

    it('THEN it is given the address to paste into the provider', async () => {
      await connect();

      const connection = await readConnection();

      expect(connection?.webhookUrl).toMatch(
        /^http:\/\/localhost:24571\/webhooks\/scm\/[0-9a-f-]{36}$/,
      );
    });

    it('THEN the secret is nowhere in what comes back', async () => {
      await connect();

      const connection = await readConnection();

      expect(JSON.stringify(connection)).not.toContain(WEBHOOK_SECRET);
    });

    it('THEN the secret is not in the database in the clear either', async () => {
      await connect();

      const stored = await testDatabase.database
        .selectFrom('scmConnection')
        .select('webhookSecretEnc')
        .executeTakeFirstOrThrow();

      expect(stored.webhookSecretEnc).not.toContain(WEBHOOK_SECRET);
    });

    it('THEN connecting again rotates the secret rather than adding a second repository', async () => {
      await connect();
      const before = await webhookPath();

      await connect({
        repoFullName: 'northwind/saltmarsh-2',
        webhookSecret: `${WEBHOOK_SECRET}_2`,
      });

      expect(await webhookPath()).toBe(before);
      expect((await readConnection())?.repoFullName).toBe('northwind/saltmarsh-2');

      // The old secret stops being accepted the moment the new one is stored.
      expect((await deliver({ secret: WEBHOOK_SECRET })).statusCode).toBe(401);
      expect((await deliver({ secret: `${WEBHOOK_SECRET}_2` })).statusCode).toBe(202);
    });
  });

  describe('WHEN a delivery arrives', () => {
    beforeEach(async () => {
      await connect();
    });

    it('THEN one sent the way GitHub sends by default is read, not refused', async () => {
      /*
       * GitHub offers two content types and defaults to the form-encoded one,
       * which wraps the delivery as `payload=<url-encoded json>`. This route
       * declared it accepted both and could only read one, so a webhook left on
       * the default settings verified its signature and came back 400 with an
       * empty body — correct, and impossible to act on.
       */
      const delivery = { ref: 'refs/heads/main', repository: { full_name: REPO } };
      const body = `payload=${encodeURIComponent(JSON.stringify(delivery))}`;
      const signature = createHmac('sha256', WEBHOOK_SECRET)
        .update(Buffer.from(body, 'utf8'))
        .digest('hex');

      const response = await server.inject({
        method: 'POST',
        url: await webhookPath(),
        payload: body,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-github-event': 'push',
          'x-github-delivery': 'form-encoded-1',
          'x-hub-signature-256': `sha256=${signature}`,
        },
      });

      expect(response.statusCode).toBe(202);
      expect(await countDeliveries(testDatabase)).toBe(1);
    });

    it('THEN a form body with no payload in it is still refused', async () => {
      // Read as far as it can be and no further: guessing at a shape nothing
      // sends would be inventing a format rather than reading one.
      const body = 'something=else';
      const signature = createHmac('sha256', WEBHOOK_SECRET)
        .update(Buffer.from(body, 'utf8'))
        .digest('hex');

      const response = await server.inject({
        method: 'POST',
        url: await webhookPath(),
        payload: body,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-github-event': 'push',
          'x-github-delivery': 'form-encoded-2',
          'x-hub-signature-256': `sha256=${signature}`,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('THEN one signed with the connection secret is kept', async () => {
      expect((await deliver({})).statusCode).toBe(202);

      const stored = await testDatabase.database
        .selectFrom('scmEventRaw')
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(stored.eventName).toBe('push');
      expect(stored.processedAt).toBeNull();
    });

    it('THEN the payload is kept exactly as it arrived', async () => {
      await deliver({ body: { ref: 'refs/heads/main', commits: [{ id: 'abc' }] } });

      const stored = await testDatabase.database
        .selectFrom('scmEventRaw')
        .select('payload')
        .executeTakeFirstOrThrow();

      expect(stored.payload).toEqual({ ref: 'refs/heads/main', commits: [{ id: 'abc' }] });
    });

    it('THEN the settings screen can see that something is coming through', async () => {
      await deliver({});

      const connection = await readConnection();

      expect(connection?.eventsReceived).toBe(1);
      expect(connection?.lastEventAt).not.toBeNull();
    });

    it('THEN one signed with the wrong secret is refused and kept nowhere', async () => {
      expect((await deliver({ secret: 'not the secret' })).statusCode).toBe(401);

      expect(await countDeliveries(testDatabase)).toBe(0);
    });

    it('THEN one with no signature at all is refused', async () => {
      const response = await server.inject({
        method: 'POST',
        url: await webhookPath(),
        payload: JSON.stringify({ ref: 'refs/heads/main' }),
        headers: { 'content-type': 'application/json', 'x-github-event': 'push' },
      });

      expect(response.statusCode).toBe(401);
      expect(await countDeliveries(testDatabase)).toBe(0);
    });

    it('THEN a body edited after signing is refused', async () => {
      const signature = createHmac('sha256', WEBHOOK_SECRET)
        .update(Buffer.from(JSON.stringify({ ref: 'refs/heads/main' }), 'utf8'))
        .digest('hex');

      const response = await server.inject({
        method: 'POST',
        url: await webhookPath(),
        payload: JSON.stringify({ ref: 'refs/heads/theirs' }),
        headers: {
          'content-type': 'application/json',
          'x-github-event': 'push',
          'x-github-delivery': 'd-edited',
          'x-hub-signature-256': `sha256=${signature}`,
        },
      });

      expect(response.statusCode).toBe(401);
      expect(await countDeliveries(testDatabase)).toBe(0);
    });

    it('THEN the same delivery sent twice is kept once', async () => {
      // A provider that gets no answer resends. Landing it twice would double
      // every commit on a card.
      await deliver({ deliveryId: 'delivery-repeated' });
      await deliver({ deliveryId: 'delivery-repeated' });

      expect(await countDeliveries(testDatabase)).toBe(1);
    });

    it('THEN one addressed to a connection that does not exist is a 404', async () => {
      const response = await deliver({
        path: '/webhooks/scm/018f0000-0000-7000-8000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });

    it('THEN an address that is not an id at all is a 404 rather than a crash', async () => {
      expect((await deliver({ path: '/webhooks/scm/not-an-id' })).statusCode).toBe(404);
    });
  });

  describe('WHEN a delivery has been read', () => {
    beforeEach(async () => {
      await connect();
    });

    it('THEN a commit naming a card shows on that card', async () => {
      const { cardKey } = await readCard();

      await deliver({ body: pushNaming(`fix: retopologise the deck (${cardKey})`) });
      await ingestScmDeliveries({ database: testDatabase.database });

      const [activity] = (await readCard()).scmActivity;

      expect(activity?.kind).toBe('commit');
      expect(activity?.ref).toBe('1c8b04e');
      expect(activity?.message).toBe(`fix: retopologise the deck (${cardKey})`);
      expect(activity?.author).toBe('Jake Winters');
      expect(activity?.url).toBe('https://example.test/commit/1c8b04e');
    });

    it('THEN an issue closing says the board has something to catch up with', async () => {
      await deliver({
        body: { action: 'closed', issue: { number: 4 } },
        headers: { 'x-github-event': 'issues' },
      });
      await ingestScmDeliveries({ database: testDatabase.database });

      const connection = await testDatabase.database
        .selectFrom('scmConnection')
        .select('forgeSpokeAt')
        .executeTakeFirstOrThrow();

      // Written down rather than acted on: what a closed issue means for a card
      // stays the sync's answer. This only brings the next pass forward.
      expect(connection.forgeSpokeAt).not.toBeNull();
    });

    it('THEN a push says nothing of the kind, however many cards it names', async () => {
      const { cardKey } = await readCard();

      await deliver({ body: pushNaming(`fix: retopologise the deck (${cardKey})`) });
      await ingestScmDeliveries({ database: testDatabase.database });

      const connection = await testDatabase.database
        .selectFrom('scmConnection')
        .select('forgeSpokeAt')
        .executeTakeFirstOrThrow();

      // A commit changes what a card has against it, not where it goes.
      expect(connection.forgeSpokeAt).toBeNull();
    });

    it('THEN a key nothing was made for links to nothing', async () => {
      await deliver({ body: pushNaming('chore: mention SLTM-BUG-9999, which does not exist') });
      await ingestScmDeliveries({ database: testDatabase.database });

      expect((await readCard()).scmActivity).toEqual([]);
    });

    it('THEN another project key is left alone', async () => {
      await deliver({ body: pushNaming('chore: this is about LPMT-ART-1, not us') });
      await ingestScmDeliveries({ database: testDatabase.database });

      expect((await readCard()).scmActivity).toEqual([]);
    });

    it('THEN a branch names a card even when no commit on it does', async () => {
      const { cardKey } = await readCard();

      await deliver({ body: pushNaming('chore: no key here at all', `feature/${cardKey}-retopo`) });
      await ingestScmDeliveries({ database: testDatabase.database });

      const branches = (await readCard()).scmActivity.filter(
        (activity) => activity.kind === 'branch',
      );

      expect(branches[0]?.ref).toBe(`feature/${cardKey}-retopo`);
    });

    it('THEN reading the same delivery twice leaves one link, not two', async () => {
      const { cardKey } = await readCard();

      await deliver({ body: pushNaming(`fix: ${cardKey}`), deliveryId: 'd-twice' });
      await ingestScmDeliveries({ database: testDatabase.database });

      // As happens after a crash between the work and the mark.
      await testDatabase.database.updateTable('scmEventRaw').set({ processedAt: null }).execute();
      await ingestScmDeliveries({ database: testDatabase.database });

      expect((await readCard()).scmActivity).toHaveLength(1);
    });

    it('THEN a delivery is only read once', async () => {
      const { cardKey } = await readCard();

      await deliver({ body: pushNaming(`fix: ${cardKey}`) });

      expect(await ingestScmDeliveries({ database: testDatabase.database })).toBe(1);
      expect(await ingestScmDeliveries({ database: testDatabase.database })).toBe(0);
    });

    it('THEN the card is announced as stale, so an open panel refetches', async () => {
      const { cardKey } = await readCard();

      await deliver({ body: pushNaming(`fix: ${cardKey}`) });
      await ingestScmDeliveries({ database: testDatabase.database });

      const announced = await testDatabase.database
        .selectFrom('domainEvent')
        .select(['name', 'aggregateId'])
        .where('name', '=', 'scm.linked')
        .executeTakeFirstOrThrow();

      expect(announced.aggregateId).toBe(cardId);
    });

    it('THEN a delivery nothing knows how to read is still marked read', async () => {
      // Providers send far more than this cares about. Leaving them unprocessed
      // would be a queue that never empties.
      await deliver({ body: { starred_at: 'now' }, headers: { 'x-github-event': 'star' } });

      expect(await ingestScmDeliveries({ database: testDatabase.database })).toBe(1);
      expect(await ingestScmDeliveries({ database: testDatabase.database })).toBe(0);
    });
  });

  describe('WHEN the repository is disconnected', () => {
    it('THEN the settings screen goes back to offering to connect one', async () => {
      await connect();
      await command('scm.disconnect', { projectId });

      expect(await readConnection()).toBeNull();
    });

    it('THEN deliveries that keep arriving are refused, having nothing to verify against', async () => {
      await connect();
      const path = await webhookPath();
      await command('scm.disconnect', { projectId });

      expect((await deliver({ path })).statusCode).toBe(404);
    });
  });

  describe('WHEN the install has no APP_SECRET set', () => {
    /**
     * The same server, started the way a fresh self-hosted install is.
     *
     * `APP_SECRET` has no default on purpose — a default would be the same key
     * on every install, which is the same as not encrypting anything. So an
     * operator who has not generated one yet is the ordinary first case, and
     * what they get told is the whole of this test.
     */
    let bareServer: FastifyInstance;
    let bareCookie: string;

    beforeAll(async () => {
      bareServer = await createServer({
        environment: readEnvironment({
          NODE_ENV: 'test',
          BASE_URL: 'http://localhost:24571',
          DATABASE_URL: 'postgres://unused',
          REDIS_URL: 'redis://unused',
          S3_ENDPOINT: 'http://unused:9000',
          S3_BUCKET: 'lpm-test',
          S3_ACCESS_KEY: 'unused',
          S3_SECRET_KEY: 'unused',
        }),
        database: testDatabase.database,
        redis,
        storage: createStubObjectStore(),
        fetch: (url, init) => forge(url, init),
      });
    });

    afterAll(async () => {
      await bareServer.close();
    });

    beforeEach(async () => {
      const response = await bareServer.inject({
        method: 'POST',
        url: '/api/c/identity.signIn',
        payload: { commandId: nextCommandId(), email: OWNER_EMAIL, password: PASSWORD },
      });

      bareCookie = readSessionCookie(response.cookies);
    });

    it('THEN connecting a repository is refused with the command to fix it', async () => {
      const response = await bareServer.inject({
        method: 'POST',
        url: '/api/c/scm.connect',
        payload: {
          commandId: nextCommandId(),
          projectId,
          provider: 'github',
          repoFullName: REPO,
          webhookSecret: WEBHOOK_SECRET,
        },
        cookies: { lpm_session: bareCookie },
      });

      const failure = response.json<{ code: string; message: string }>();

      // It used to be a five hundred reading "something went wrong, the problem
      // has been logged" — with the sentence that says exactly what to do
      // sitting in a container log nobody had open.
      expect(response.statusCode).not.toBe(500);
      expect(failure.code).toBe('INVARIANT_VIOLATED');
      expect(failure.message).toContain('APP_SECRET');
      expect(failure.message).toContain('openssl rand -base64 32');
    });

    it('THEN nothing half-connected is left behind', async () => {
      const connections = await testDatabase.database
        .selectFrom('scmConnection')
        .select('id')
        .execute();

      expect(connections).toEqual([]);
    });
  });

  describe('WHEN somebody without the run of the project tries to connect one', () => {
    it('THEN they are refused', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/c/scm.connect',
        payload: {
          commandId: nextCommandId(),
          projectId,
          provider: 'github',
          repoFullName: REPO,
          webhookSecret: WEBHOOK_SECRET,
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });
  describe('WHEN a connection is given credentials to read the repository', () => {
    /** A real key, so the signature the forge would check is a real signature. */
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    /** A forge that hands out a token and admits to owning the repository. */
    function forgeThatWorks(): (url: string) => Promise<Response> {
      return (url) =>
        Promise.resolve(
          url.includes('/access_tokens')
            ? new Response(
                JSON.stringify({ token: 'ghs_secret', expires_at: '2030-01-01T00:00:00Z' }),
              )
            : new Response(JSON.stringify({ full_name: REPO })),
        );
    }

    async function connectApp(
      overrides: Record<string, unknown> = {},
    ): Promise<Awaited<ReturnType<typeof server.inject>>> {
      return command('scm.connectApp', {
        projectId,
        appId: '412345',
        installationId: '98765',
        privateKey,
        ...overrides,
      });
    }

    it('THEN the credentials are checked against the forge before they are stored', async () => {
      await connect();
      forge = forgeThatWorks();

      const response = await connectApp();

      expect(response.statusCode).toBe(200);

      const connection = await readConnection();

      expect(connection?.appAccess).toMatchObject({
        appId: '412345',
        installationId: '98765',
      });
      expect(connection?.appAccess?.checkedAt).not.toBeNull();
    });

    it('THEN the private key never comes back, the way the webhook secret does not', async () => {
      await connect();
      forge = forgeThatWorks();
      await connectApp();

      // A screen that could show it again would be a way to read it out of any
      // project you can open.
      expect(JSON.stringify(await readConnection())).not.toContain('PRIVATE KEY');
    });

    it('THEN a forge that will not issue a token stores nothing', async () => {
      await connect();
      forge = () => Promise.resolve(new Response('{}', { status: 401 }));

      const response = await connectApp();

      expect(response.statusCode).toBe(422);
      expect(response.json<{ message: string }>().message).toMatch(/app id and private key/);
      expect((await readConnection())?.appAccess).toBeNull();
    });

    it('THEN an installation on the wrong repository is refused, and says which', async () => {
      await connect();
      forge = (url) =>
        Promise.resolve(
          url.includes('/access_tokens')
            ? new Response(
                JSON.stringify({ token: 'ghs_secret', expires_at: '2030-01-01T00:00:00Z' }),
              )
            : new Response('{}', { status: 404 }),
        );

      const response = await connectApp();

      // The two halves fail for different reasons a studio fixes differently.
      expect(response.statusCode).toBe(422);
      expect(response.json<{ message: string }>().message).toMatch(new RegExp(`not on ${REPO}`));
    });

    it('THEN a project with no repository has nothing to give credentials to', async () => {
      const response = await connectApp();

      expect(response.statusCode).toBe(422);
    });

    it('THEN taking them away leaves the webhook exactly as it was', async () => {
      await connect();
      forge = forgeThatWorks();
      await connectApp();

      await command('scm.disconnectApp', { projectId });

      const connection = await readConnection();

      expect(connection?.appAccess).toBeNull();
      expect(connection?.repoFullName).toBe(REPO);
    });
  });
});

async function countDeliveries(testDatabase: TestDatabase): Promise<number> {
  const counted = await testDatabase.database
    .selectFrom('scmEventRaw')
    .select((builder) => builder.fn.countAll<string>().as('total'))
    .executeTakeFirstOrThrow();

  return Number(counted.total);
}
