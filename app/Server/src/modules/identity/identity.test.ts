import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createStubObjectStore } from '../../storage/index.js';
import { createStubRedis } from '../../testing/index.js';
import { CATALOGUES, permittedActions } from '../../domain/index.js';
import { defaultPermissionGroups } from '../permissions/default-groups.js';
import { createServer } from '../../server/create-server.js';
import { readEnvironment } from '../../server/environment.js';
import { hashPassword } from './password-hasher.js';

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

/** Redis is not on the identity path; a stub keeps these tests to one dependency. */
/**
 * Enough of Redis for a server to start: a health probe, and the subscriber the
 * realtime hub opens. Nothing publishes in these tests, so nothing arrives.
 */
let commandCounter = 0;

/** A fresh id per call, so nothing collides with the idempotency ledger. */
function nextCommandId(): string {
  commandCounter += 1;
  return `018f0000-0000-7000-8000-${String(commandCounter).padStart(12, '0')}`;
}

function postCommand(name: string, body: Record<string, unknown>): InjectOptions {
  return {
    method: 'POST',
    url: `/api/c/${name}`,
    payload: { commandId: nextCommandId(), ...body },
  };
}

describe('GIVEN an API server backed by a real database', () => {
  let testDatabase: TestDatabase;
  let server: FastifyInstance;
  let passwordHash: string;

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
  });

  describe('WHEN the install has never been set up', () => {
    it('THEN identity.me refuses an anonymous caller', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/q/identity.me' });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    });

    it('THEN system.health reports it as not set up', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/q/system.health' });

      expect(response.json<{ data: { setupCompleted: boolean } }>().data.setupCompleted).toBe(
        false,
      );
    });
  });

  describe('WHEN completeSetup is called with a password below the minimum', () => {
    it('THEN it fails naming the offending field, and creates nothing', async () => {
      const response = await server.inject(
        postCommand('identity.completeSetup', {
          serverName: 'Northwind Studio',
          baseUrl: 'http://localhost:24571',
          admin: { email: OWNER_EMAIL, password: 'short', displayName: 'Jake Winters' },
        }),
      );

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        ok: false,
        code: 'VALIDATION_FAILED',
        fields: { 'admin.password': expect.any(String) as unknown },
      });

      const users = await testDatabase.database.selectFrom('appUser').selectAll().execute();
      expect(users).toHaveLength(0);
    });
  });

  describe('WHEN completeSetup is called with a valid owner', () => {
    let setupResponse: Awaited<ReturnType<typeof server.inject>>;

    beforeEach(async () => {
      setupResponse = await server.inject(
        postCommand('identity.completeSetup', {
          serverName: 'Northwind Studio',
          baseUrl: 'http://localhost:24571',
          admin: { email: OWNER_EMAIL, password: PASSWORD, displayName: 'Jake Winters' },
        }),
      );
    });

    it('THEN the account, owner, membership and install settings all exist', async () => {
      const account = await testDatabase.database
        .selectFrom('account')
        .selectAll()
        .executeTakeFirstOrThrow();
      const user = await testDatabase.database
        .selectFrom('appUser')
        .selectAll()
        .executeTakeFirstOrThrow();
      const membership = await testDatabase.database
        .selectFrom('membership')
        .selectAll()
        .executeTakeFirstOrThrow();
      const install = await testDatabase.database
        .selectFrom('installSettings')
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(account.name).toBe('Northwind Studio');
      expect(user.initials).toBe('JW');
      expect(membership.role).toBe('owner');
      expect(install.setupCompletedAt).not.toBeNull();
    });

    it('THEN the install is named as owned by the person who set it up', async () => {
      const user = await testDatabase.database
        .selectFrom('appUser')
        .select('id')
        .executeTakeFirstOrThrow();
      const install = await testDatabase.database
        .selectFrom('installSettings')
        .select('ownerUserId')
        .executeTakeFirstOrThrow();

      expect(install.ownerUserId).toBe(user.id);
    });

    /*
     * An install used to begin with no groups at all, so the first thing
     * anybody did with permissions was build the seven obvious ones by hand.
     */
    it('THEN it starts with a group for each heading, and one that holds the lot', async () => {
      const groups = await testDatabase.database
        .selectFrom('permissionGroup')
        .select('name')
        .orderBy('name')
        .execute();

      expect(groups.map((group) => group.name)).toEqual(
        [...defaultPermissionGroups().map((group) => group.name)].sort((left, right) =>
          left.localeCompare(right),
        ),
      );
    });

    it('THEN Administrator says allow to every action there is', async () => {
      const rules = await testDatabase.database
        .selectFrom('permissionRule')
        .innerJoin('permissionGroup', 'permissionGroup.id', 'permissionRule.groupId')
        .select(['permissionRule.action', 'permissionRule.effect'])
        .where('permissionGroup.name', '=', 'Administrator')
        .execute();

      expect(rules.map((rule) => rule.action).sort()).toEqual([...permittedActions].sort());
      expect(rules.every((rule) => rule.effect === 'allow')).toBe(true);
    });

    /*
     * Every default is an allow, so one given out by mistake has handed over
     * too much rather than locked somebody out of something. Nothing here can
     * take anything away.
     */
    it('THEN not one default rule is a denial', async () => {
      const denials = await testDatabase.database
        .selectFrom('permissionRule')
        .select('action')
        .where('effect', '=', 'deny')
        .execute();

      expect(denials).toEqual([]);
    });

    it('THEN each heading group holds exactly the actions filed under it', async () => {
      const board = await testDatabase.database
        .selectFrom('permissionRule')
        .innerJoin('permissionGroup', 'permissionGroup.id', 'permissionRule.groupId')
        .select('permissionRule.action')
        .where('permissionGroup.name', '=', CATALOGUES['catalog.board'].label)
        .execute();

      expect(board.map((rule) => rule.action).sort()).toEqual(
        [...CATALOGUES['catalog.board'].actions].sort(),
      );
    });

    it('THEN they are ordinary groups, so the studio can delete one', async () => {
      const cookie = readSessionCookie(setupResponse.cookies);
      const group = await testDatabase.database
        .selectFrom('permissionGroup')
        .select('id')
        .where('name', '=', 'Releases')
        .executeTakeFirstOrThrow();

      const response = await server.inject({
        ...postCommand('permissions.deleteGroup', { groupId: group.id }),
        cookies: { lpm_session: cookie },
      });

      expect(response.statusCode).toBe(200);
    });

    it('THEN the password is stored as an Argon2id hash, never in the clear', async () => {
      const user = await testDatabase.database
        .selectFrom('appUser')
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.passwordHash).not.toContain(PASSWORD);
    });

    it('THEN an installCompleted event is appended without any password material', async () => {
      const event = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(event.name).toBe('identity.installCompleted');
      expect(JSON.stringify(event.payload)).not.toContain(PASSWORD);
    });

    it('THEN a second attempt is refused', async () => {
      const response = await server.inject(
        postCommand('identity.completeSetup', {
          serverName: 'Hijack',
          baseUrl: 'http://evil.test',
          admin: { email: 'evil@example.test', password: PASSWORD, displayName: 'Evil' },
        }),
      );

      expect(response.json()).toMatchObject({ ok: false, code: 'SETUP_ALREADY_COMPLETED' });
    });

    it('THEN the caller is signed in, so setup does not bounce to the login screen', () => {
      expect(setupResponse.json()).toMatchObject({ ok: true });
      expect(setupResponse.cookies[0]).toMatchObject({ name: 'lpm_session', httpOnly: true });
    });

    it('THEN that session immediately works against identity.me', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/identity.me',
        cookies: { lpm_session: readSessionCookie(setupResponse.cookies) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: { user: { email: string } } }>().data.user.email).toBe(
        OWNER_EMAIL,
      );
    });
  });

  describe('WHEN an install already has an active owner', () => {
    beforeEach(async () => {
      await seedInstall(testDatabase.database, { email: OWNER_EMAIL, passwordHash });
    });

    it('THEN signing in with the right password issues a session cookie', async () => {
      const response = await server.inject(
        postCommand('identity.signIn', { email: OWNER_EMAIL, password: PASSWORD }),
      );

      expect(response.json()).toMatchObject({ ok: true });
      expect(response.cookies[0]).toMatchObject({ name: 'lpm_session', httpOnly: true });
    });

    it('THEN the session token is stored hashed, not as issued', async () => {
      const response = await server.inject(
        postCommand('identity.signIn', { email: OWNER_EMAIL, password: PASSWORD }),
      );
      const issued = readSessionCookie(response.cookies);

      const session = await testDatabase.database
        .selectFrom('session')
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(session.tokenHash).toHaveLength(64);
      expect(session.tokenHash).not.toBe(issued);
    });

    it('THEN an email in different case still matches, because the column is citext', async () => {
      const response = await server.inject(
        postCommand('identity.signIn', {
          email: OWNER_EMAIL.toUpperCase(),
          password: PASSWORD,
        }),
      );

      expect(response.json()).toMatchObject({ ok: true });
    });

    it('THEN a wrong password and an unknown email are indistinguishable', async () => {
      const wrongPassword = await server.inject(
        postCommand('identity.signIn', { email: OWNER_EMAIL, password: 'not-the-password' }),
      );
      const unknownEmail = await server.inject(
        postCommand('identity.signIn', { email: 'nobody@nowhere.test', password: PASSWORD }),
      );

      // Distinguishing them would let anyone enumerate the accounts on this
      // install by watching which message comes back.
      expect(wrongPassword.json()).toEqual(unknownEmail.json());
      expect(wrongPassword.statusCode).toBe(unknownEmail.statusCode);
    });

    it('THEN a failed sign-in issues no cookie and records no session', async () => {
      const response = await server.inject(
        postCommand('identity.signIn', { email: OWNER_EMAIL, password: 'not-the-password' }),
      );

      const sessions = await testDatabase.database.selectFrom('session').selectAll().execute();

      expect(response.cookies).toHaveLength(0);
      expect(sessions).toHaveLength(0);
    });

    it('THEN signing in records the moment, so last-seen is meaningful', async () => {
      await server.inject(
        postCommand('identity.signIn', { email: OWNER_EMAIL, password: PASSWORD }),
      );

      const user = await testDatabase.database
        .selectFrom('appUser')
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(user.lastSeenAt).not.toBeNull();
    });

    it('THEN a userSignedIn event reaches the outbox', async () => {
      await server.inject(
        postCommand('identity.signIn', { email: OWNER_EMAIL, password: PASSWORD }),
      );

      const events = await testDatabase.database.selectFrom('domainEvent').select('name').execute();

      expect(events.map((event) => event.name)).toContain('identity.userSignedIn');
    });
  });

  describe('WHEN the account has been suspended', () => {
    beforeEach(async () => {
      await seedInstall(testDatabase.database, {
        email: OWNER_EMAIL,
        passwordHash,
        status: 'suspended',
      });
    });

    it('THEN the right password is still refused', async () => {
      const response = await server.inject(
        postCommand('identity.signIn', { email: OWNER_EMAIL, password: PASSWORD }),
      );

      expect(response.json()).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    });
  });

  describe('WHEN a user is signed in', () => {
    let sessionToken: string;

    beforeEach(async () => {
      await seedInstall(testDatabase.database, { email: OWNER_EMAIL, passwordHash });
      const response = await server.inject(
        postCommand('identity.signIn', { email: OWNER_EMAIL, password: PASSWORD }),
      );
      sessionToken = readSessionCookie(response.cookies);
    });

    it('THEN identity.me returns the user, their memberships and the install', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/identity.me',
        cookies: { lpm_session: sessionToken },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: unknown }>().data).toMatchObject({
        user: { email: OWNER_EMAIL, displayName: 'Owner Person' },
        memberships: [{ accountName: 'Northwind Studio', role: 'owner' }],
        install: { serverName: 'Northwind Studio' },
      });
    });

    it('THEN a made-up session token is rejected', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/identity.me',
        cookies: { lpm_session: 'not-a-real-token' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('THEN signing out deletes the session row', async () => {
      await server.inject({
        ...postCommand('identity.signOut', {}),
        cookies: { lpm_session: sessionToken },
      });

      const sessions = await testDatabase.database.selectFrom('session').selectAll().execute();

      expect(sessions).toHaveLength(0);
    });

    it('THEN the token stops working once signed out', async () => {
      await server.inject({
        ...postCommand('identity.signOut', {}),
        cookies: { lpm_session: sessionToken },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/q/identity.me',
        cookies: { lpm_session: sessionToken },
      });

      expect(response.statusCode).toBe(401);
    });

    it('THEN system.health reports the name chosen at setup, not the env default', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/q/system.health' });

      expect(response.json<{ data: { serverName: string } }>().data.serverName).toBe(
        'Northwind Studio',
      );
    });
  });

  describe('WHEN somebody works through a list of passwords', () => {
    it('THEN they are refused long before the list is', async () => {
      // The one attack this server is exposed to without a session. The limit
      // is far above what a person mistypes and far below what a list is worth
      // working through.
      const attempts = await Promise.all(
        Array.from({ length: 12 }, () =>
          server.inject(postCommand('identity.signIn', { email: OWNER_EMAIL, password: 'wrong' })),
        ),
      );

      const refused = attempts.filter((attempt) => attempt.statusCode === 429);

      expect(refused.length).toBeGreaterThan(0);
      expect(refused[0]?.json()).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    });

    it('THEN the right password is refused too, so a stolen one buys nothing', async () => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await server.inject(postCommand('identity.signIn', { email: OWNER_EMAIL, password: 'no' }));
      }

      const response = await server.inject(
        postCommand('identity.signIn', { email: OWNER_EMAIL, password: PASSWORD }),
      );

      expect(response.statusCode).toBe(429);
    });

    it('THEN reading the board is not held to the same allowance', async () => {
      // Sharing one budget would mean a busy board spent what guards sign-in.
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await server.inject(postCommand('identity.signIn', { email: OWNER_EMAIL, password: 'no' }));
      }

      const response = await server.inject({ method: 'GET', url: '/api/q/system.health' });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('WHEN signing out without a session', () => {
    it('THEN it still succeeds, so a browser that lost its cookie is not stuck', async () => {
      const response = await server.inject(postCommand('identity.signOut', {}));

      expect(response.json()).toEqual({ ok: true });
    });
  });
});

function readSessionCookie(cookies: readonly { name: string; value: string }[]): string {
  const cookie = cookies.find((candidate) => candidate.name === 'lpm_session');

  if (cookie === undefined) {
    throw new Error('Expected a session cookie to have been set.');
  }

  return cookie.value;
}
