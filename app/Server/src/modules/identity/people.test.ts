import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import type { AgentsView, PeopleView } from '@lpm/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createStubObjectStore } from '../../storage/index.js';
import { createStubRedis } from '../../testing/index.js';
import { createServer } from '../../server/create-server.js';
import { readEnvironment } from '../../server/environment.js';
import { hashPassword } from './password-hasher.js';

const PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'a phrase beats a puzzle';
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

describe('GIVEN an install with an admin and nobody else', () => {
  let testDatabase: TestDatabase;
  let server: FastifyInstance;
  let passwordHash: string;
  let ownerCookie: string;
  let ownerUserId: string;

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

    ownerUserId = install.userId;
    ownerCookie = await signIn(OWNER_EMAIL, PASSWORD);
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

  async function signIn(email: string, password: string): Promise<string> {
    const response = await server.inject({
      method: 'POST',
      url: '/api/c/identity.signIn',
      payload: { commandId: nextCommandId(), email, password },
    });

    return readSessionCookie(response.cookies);
  }

  async function trySignIn(email: string, password: string): Promise<number> {
    const response = await server.inject({
      method: 'POST',
      url: '/api/c/identity.signIn',
      payload: { commandId: nextCommandId(), email, password },
    });

    return response.statusCode;
  }

  async function readPeople(search?: string, after?: string): Promise<PeopleView> {
    const query = new URLSearchParams();

    if (search !== undefined) query.set('search', search);
    if (after !== undefined) query.set('after', after);

    const response = await server.inject({
      method: 'GET',
      url: `/api/q/identity.people?${query.toString()}`,
      cookies: { lpm_session: ownerCookie },
    });

    return response.json<{ data: PeopleView }>().data;
  }

  async function addPerson(displayName: string, email: string, role = 'member'): Promise<string> {
    const response = await command('identity.createUser', {
      email,
      displayName,
      role,
      password: PASSWORD,
    });

    return response.json<{ id: string }>().id;
  }

  describe('WHEN the admin adds a person', () => {
    it('THEN that person can sign in with the password they were given', async () => {
      await addPerson('Mira Kaur', 'mira@northwind.test');

      expect(await trySignIn('mira@northwind.test', PASSWORD)).toBe(200);
    });

    it('THEN they are on the list, with the role and the initials they were given', async () => {
      await addPerson('Mira Kaur', 'mira@northwind.test', 'lead');

      const listed = (await readPeople()).people.find(
        (person) => person.displayName === 'Mira Kaur',
      );

      expect(listed).toMatchObject({ role: 'lead', initials: 'MK', status: 'active' });
    });

    it('THEN they have never been seen until they sign in', async () => {
      await addPerson('Mira Kaur', 'mira@northwind.test');

      const listed = (await readPeople()).people.find(
        (person) => person.displayName === 'Mira Kaur',
      );

      expect(listed?.lastSeenAt).toBeNull();
    });

    it('THEN the same address again is refused, naming the field it is about', async () => {
      await addPerson('Mira Kaur', 'mira@northwind.test');

      const response = await command('identity.createUser', {
        email: 'MIRA@NORTHWIND.TEST',
        displayName: 'Mira Again',
        role: 'member',
        password: PASSWORD,
      });

      const failure = response.json<{ code: string; fields?: Record<string, string> }>();

      expect(failure.code).toBe('CONFLICT');
      expect(failure.fields?.email).toBe('That address is already in use.');
    });

    it('THEN it is on the audit trail', async () => {
      await addPerson('Mira Kaur', 'mira@northwind.test');

      const events = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .where('name', '=', 'identity.userCreated')
        .execute();

      expect(events).toHaveLength(1);
    });
  });

  /**
   * The rung underneath somebody nobody has given anything.
   *
   * No screen asks for it any more, so the command has to have an answer of its
   * own — and the only safe answer to a question nobody was asked is the one
   * that grants least. Everything above it is then something a person
   * deliberately allowed.
   */
  describe('WHEN the admin adds a person without saying what rung they are on', () => {
    it('THEN they arrive able to read this install and nothing else', async () => {
      const response = await command('identity.createUser', {
        email: 'mira@northwind.test',
        displayName: 'Mira Kaur',
        password: PASSWORD,
      });

      const membership = await testDatabase.database
        .selectFrom('membership')
        .select('role')
        .where('userId', '=', response.json<{ id: string }>().id)
        .executeTakeFirstOrThrow();

      expect(membership.role).toBe('viewer');
    });

    it('THEN a caller that does say one is still obeyed, because a script may have a reason', async () => {
      await addPerson('Mira Kaur', 'mira@northwind.test', 'lead');

      const listed = (await readPeople()).people.find(
        (person) => person.displayName === 'Mira Kaur',
      );

      expect(listed?.role).toBe('lead');
    });
  });

  describe('WHEN somebody who is not an admin asks who is on the install', () => {
    it('THEN they are refused', async () => {
      await addPerson('Mira Kaur', 'mira@northwind.test', 'lead');
      const theirCookie = await signIn('mira@northwind.test', PASSWORD);

      const response = await server.inject({
        method: 'GET',
        url: '/api/q/identity.people',
        cookies: { lpm_session: theirCookie },
      });

      expect(response.statusCode).toBe(403);
    });

    it('THEN they cannot add anybody either', async () => {
      await addPerson('Mira Kaur', 'mira@northwind.test', 'lead');
      const theirCookie = await signIn('mira@northwind.test', PASSWORD);

      const response = await command(
        'identity.createUser',
        {
          email: 'sneaky@northwind.test',
          displayName: 'Sneaky',
          role: 'owner',
          password: PASSWORD,
        },
        theirCookie,
      );

      expect(response.statusCode).toBe(403);
    });
  });

  describe('WHEN a person is suspended', () => {
    let miraId: string;

    beforeEach(async () => {
      miraId = await addPerson('Mira Kaur', 'mira@northwind.test');
    });

    it('THEN they can no longer sign in', async () => {
      await command('identity.setUserStatus', { userId: miraId, status: 'suspended' });

      expect(await trySignIn('mira@northwind.test', PASSWORD)).toBe(403);
    });

    it('THEN the session they were already using is gone', async () => {
      await signIn('mira@northwind.test', PASSWORD);
      await command('identity.setUserStatus', { userId: miraId, status: 'suspended' });

      const sessions = await testDatabase.database
        .selectFrom('session')
        .select('id')
        .where('userId', '=', miraId)
        .execute();

      expect(sessions).toHaveLength(0);
    });

    it('THEN the list says so', async () => {
      await command('identity.setUserStatus', { userId: miraId, status: 'suspended' });

      const listed = (await readPeople()).people.find((person) => person.userId === miraId);

      expect(listed?.status).toBe('suspended');
    });

    it('THEN letting them back in lets them sign in again', async () => {
      await command('identity.setUserStatus', { userId: miraId, status: 'suspended' });
      await command('identity.setUserStatus', { userId: miraId, status: 'active' });

      expect(await trySignIn('mira@northwind.test', PASSWORD)).toBe(200);
    });
  });

  describe('WHEN the person who set the install up is the one being changed', () => {
    /*
     * "An admin remains" keeps somebody in the chair but says nothing about
     * who: a studio could promote a contractor, demote the founder, and the
     * rule would be satisfied the whole way down. One account stays.
     */
    it('THEN their role cannot be changed, whoever else is an admin', async () => {
      await addPerson('Mira Kaur', 'mira@northwind.test', 'owner');

      const response = await command('identity.setUserRole', {
        userId: ownerUserId,
        role: 'member',
      });

      expect(response.json()).toMatchObject({ code: 'INVARIANT_VIOLATED' });
      expect(response.json<{ message: string }>().message).toContain('owns it for good');
    });

    /*
     * Asked by somebody else, not by the owner themselves.
     *
     * "Suspending your own account would lock you out of it" already refuses
     * the owner asking about the owner, so a test that used the owner's own
     * session would pass whether this rule existed or not.
     */
    it('THEN another admin cannot suspend them', async () => {
      await addPerson('Mira Kaur', 'mira@northwind.test', 'owner');

      const miraCookie = await signIn('mira@northwind.test', PASSWORD);
      const response = await server.inject({
        method: 'POST',
        url: '/api/c/identity.setUserStatus',
        payload: { commandId: nextCommandId(), userId: ownerUserId, status: 'suspended' },
        cookies: { lpm_session: miraCookie },
      });

      expect(response.json()).toMatchObject({ code: 'INVARIANT_VIOLATED' });
      expect(response.json<{ message: string }>().message).toContain('owns it for good');
    });

    it('THEN their password can still be reset, which is theirs to use', async () => {
      const response = await command('identity.resetUserPassword', {
        userId: ownerUserId,
        password: 'a-brand-new-password',
      });

      expect(response.statusCode).toBe(200);
    });

    it('THEN somebody else who is an owner is still changeable', async () => {
      const miraOwnerId = await addPerson('Mira Kaur', 'mira@northwind.test', 'owner');

      const response = await command('identity.setUserRole', {
        userId: miraOwnerId,
        role: 'member',
      });
      const membership = await testDatabase.database
        .selectFrom('membership')
        .select('role')
        .where('userId', '=', miraOwnerId)
        .executeTakeFirstOrThrow();

      expect(response.statusCode).toBe(200);
      expect(membership.role).toBe('member');
    });

    it('THEN an owner who demotes themselves can no longer see the people', async () => {
      await addPerson('Mira Kaur', 'mira@northwind.test', 'owner');

      const miraCookie = await signIn('mira@northwind.test', PASSWORD);
      const miraId = (
        await testDatabase.database
          .selectFrom('appUser')
          .select('id')
          .where('email', '=', 'mira@northwind.test')
          .executeTakeFirstOrThrow()
      ).id;

      await server.inject({
        method: 'POST',
        url: '/api/c/identity.setUserRole',
        payload: { commandId: nextCommandId(), userId: miraId, role: 'member' },
        cookies: { lpm_session: miraCookie },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/q/identity.people',
        cookies: { lpm_session: miraCookie },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('WHEN the install is older than the step that names its owner', () => {
    /*
     * Restored from a backup taken before `owner_user_id` existed, so nobody is
     * named and nobody is permanent. The cover underneath is the only thing
     * left, and it still holds.
     */
    beforeEach(async () => {
      await testDatabase.database
        .updateTable('installSettings')
        .set({ ownerUserId: null })
        .execute();
    });

    it('THEN the only admin still cannot be demoted', async () => {
      const response = await command('identity.setUserRole', {
        userId: ownerUserId,
        role: 'member',
      });

      expect(response.json()).toMatchObject({ code: 'INVARIANT_VIOLATED' });
      expect(response.json<{ message: string }>().message).toContain('somebody else an admin');
    });

    it('THEN the only admin still cannot be suspended by anybody else', async () => {
      const miraId = await addPerson('Mira Kaur', 'mira@northwind.test', 'owner');

      // Mira is an admin now, so the cover would let the founder go — except
      // she is suspended first, which puts the count back to one.
      await command('identity.setUserStatus', { userId: miraId, status: 'suspended' });

      const response = await command('identity.setUserStatus', {
        userId: ownerUserId,
        status: 'suspended',
      });

      expect(response.json()).toMatchObject({ code: 'INVARIANT_VIOLATED' });
    });

    it('THEN a second admin makes the first one demotable again', async () => {
      await addPerson('Mira Kaur', 'mira@northwind.test', 'owner');

      const response = await command('identity.setUserRole', {
        userId: ownerUserId,
        role: 'member',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('WHEN an admin suspends their own account', () => {
    it('THEN it is refused, whoever else is an admin', async () => {
      await addPerson('Mira Kaur', 'mira@northwind.test', 'owner');

      const response = await command('identity.setUserStatus', {
        userId: ownerUserId,
        status: 'suspended',
      });

      expect(response.json()).toMatchObject({ code: 'INVARIANT_VIOLATED' });
    });
  });

  describe('WHEN an admin resets somebody else’s password', () => {
    it('THEN the old password stops working and the new one starts', async () => {
      const miraId = await addPerson('Mira Kaur', 'mira@northwind.test');

      await command('identity.resetUserPassword', { userId: miraId, password: NEW_PASSWORD });

      expect(await trySignIn('mira@northwind.test', PASSWORD)).toBe(401);
      expect(await trySignIn('mira@northwind.test', NEW_PASSWORD)).toBe(200);
    });

    it('THEN they are signed out of wherever they already were', async () => {
      const miraId = await addPerson('Mira Kaur', 'mira@northwind.test');
      await signIn('mira@northwind.test', PASSWORD);

      await command('identity.resetUserPassword', { userId: miraId, password: NEW_PASSWORD });

      const sessions = await testDatabase.database
        .selectFrom('session')
        .select('id')
        .where('userId', '=', miraId)
        .execute();

      expect(sessions).toHaveLength(0);
    });
  });

  describe('WHEN somebody changes their own name', () => {
    async function readMe(cookie?: string): Promise<{ displayName: string; initials: string }> {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/identity.me',
        ...(cookie === undefined ? {} : { cookies: { lpm_session: cookie } }),
        cookies: { lpm_session: cookie ?? ownerCookie },
      });

      return response.json<{ data: { user: { displayName: string; initials: string } } }>().data
        .user;
    }

    it('THEN the name and the letters both change', async () => {
      await command('identity.updateProfile', { displayName: 'Jacob Winters', initials: 'jbw' });

      // Upper-cased on the way in: what somebody types is their business and
      // what the board draws is the product's.
      expect(await readMe()).toMatchObject({ displayName: 'Jacob Winters', initials: 'JBW' });
    });

    it('THEN sending one leaves the other alone', async () => {
      const before = await readMe();

      await command('identity.updateProfile', { initials: 'ZZ' });

      expect(await readMe()).toMatchObject({ displayName: before.displayName, initials: 'ZZ' });
    });

    it('THEN the theme is theirs, and it comes back with them', async () => {
      /*
       * On the person rather than in their browser, which is the difference
       * between a preference and a habit of one machine. It rides on
       * `identity.me` because that is the query the app waits for before it
       * draws anything, and a theme arriving any later is a theme somebody
       * watches the app change into.
       */
      expect(await readMe()).toMatchObject({ theme: 'dark' });

      await command('identity.updateProfile', { theme: 'light' });

      expect(await readMe()).toMatchObject({ theme: 'light' });
    });

    it('THEN a theme they wrote is kept whole, and comes back with them', async () => {
      const palette = {
        background: '#101418',
        text: '#e9edf1',
        accent: '#7f5af0',
        secondary: '#2cb67d',
        tertiary: '#ff8906',
        danger: '#ef4565',
        warning: '#f9bc60',
        success: '#2cb67d',
        scheme: 'dark',
      };

      await command('identity.updateProfile', { theme: 'custom', themeColors: palette });

      // Eight colours rather than ninety: everything else the app draws with is
      // derived from these, so this is the whole of what has to be stored.
      expect(await readMe()).toMatchObject({ theme: 'custom', themeColors: palette });
    });

    it('THEN going back to a theme that shipped takes the colours with it', async () => {
      await command('identity.updateProfile', {
        theme: 'custom',
        themeColors: {
          background: '#101418',
          text: '#e9edf1',
          accent: '#7f5af0',
          secondary: '#2cb67d',
          tertiary: '#ff8906',
          danger: '#ef4565',
          warning: '#f9bc60',
          success: '#2cb67d',
          scheme: 'dark',
        },
      });

      await command('identity.updateProfile', { theme: 'dark', themeColors: null });

      // Leaving them behind would mean choosing Dark and getting yesterday's
      // colours back the next time somebody chose Yours.
      expect(await readMe()).toMatchObject({ theme: 'dark', themeColors: null });
    });

    it('THEN a colour that is not a colour is refused rather than stored', async () => {
      const response = await command('identity.updateProfile', {
        theme: 'custom',
        themeColors: { background: 'periwinkle', text: '#fff', accent: '#fff' },
      });

      expect(response.statusCode).toBe(422);
      expect(await readMe()).toMatchObject({ theme: 'dark', themeColors: null });
    });

    it('THEN a theme this install has never heard of is refused', async () => {
      // The column has a check constraint behind this. A theme nothing can
      // render is a person whose app does not draw.
      const response = await command('identity.updateProfile', { theme: 'neon' });

      expect(response.statusCode).toBe(422);
      expect(await readMe()).toMatchObject({ theme: 'dark' });
    });

    it('THEN changing a name leaves the theme where it was', async () => {
      await command('identity.updateProfile', { theme: 'light' });
      await command('identity.updateProfile', { displayName: 'Jacob Winters' });

      expect(await readMe()).toMatchObject({ displayName: 'Jacob Winters', theme: 'light' });
    });

    it('THEN sending nothing is not a failure, and changes nothing', async () => {
      const before = await readMe();
      const response = await command('identity.updateProfile', {});

      expect(response.statusCode).toBe(200);
      expect(await readMe()).toMatchObject(before);
    });

    it('THEN it reaches nobody else, whoever is asking', async () => {
      // There is no user id on this command, and that is the whole guard: the
      // only row it can write is the one the session names.
      const otherId = await addPerson('Mira Kaur', 'mira@northwind.test');
      const theirCookie = await signIn('mira@northwind.test', PASSWORD);

      await command('identity.updateProfile', { displayName: 'Renamed' }, theirCookie);

      const owner = await testDatabase.database
        .selectFrom('appUser')
        .select(['displayName'])
        .where('email', '=', OWNER_EMAIL)
        .executeTakeFirstOrThrow();
      const them = await testDatabase.database
        .selectFrom('appUser')
        .select(['displayName'])
        .where('id', '=', otherId)
        .executeTakeFirstOrThrow();

      expect(them.displayName).toBe('Renamed');
      expect(owner.displayName).not.toBe('Renamed');
    });

    it('THEN a viewer may change their own, because it answers to no permission', async () => {
      await addPerson('Val Viewer', 'val@northwind.test', 'viewer');
      const theirCookie = await signIn('val@northwind.test', PASSWORD);

      const response = await command(
        'identity.updateProfile',
        { displayName: 'Valerie Viewer' },
        theirCookie,
      );

      expect(response.statusCode).toBe(200);
      expect(await readMe(theirCookie)).toMatchObject({ displayName: 'Valerie Viewer' });
    });

    it('THEN a name nobody could read is refused on the field', async () => {
      const response = await command('identity.updateProfile', { initials: 'FOURC' });

      expect(response.statusCode).toBe(422);
      expect(response.json<{ fields?: Record<string, string> }>().fields?.initials).toContain(
        'Three letters',
      );
    });
  });

  describe('WHEN somebody changes their own password', () => {
    it('THEN the wrong current password changes nothing', async () => {
      const response = await command('identity.changePassword', {
        currentPassword: 'not the one',
        newPassword: NEW_PASSWORD,
      });

      expect(response.statusCode).toBe(401);
      expect(await trySignIn(OWNER_EMAIL, PASSWORD)).toBe(200);
    });

    it('THEN the new password is the one that signs them in', async () => {
      await command('identity.changePassword', {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      });

      expect(await trySignIn(OWNER_EMAIL, PASSWORD)).toBe(401);
      expect(await trySignIn(OWNER_EMAIL, NEW_PASSWORD)).toBe(200);
    });

    it('THEN the browser that changed it is still signed in, and no other is', async () => {
      const elsewhere = await signIn(OWNER_EMAIL, PASSWORD);

      const changed = await command('identity.changePassword', {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      });

      const reissued = readSessionCookie(changed.cookies);
      const here = await server.inject({
        method: 'GET',
        url: '/api/q/identity.me',
        cookies: { lpm_session: reissued },
      });
      const there = await server.inject({
        method: 'GET',
        url: '/api/q/identity.me',
        cookies: { lpm_session: elsewhere },
      });

      expect(here.statusCode).toBe(200);
      expect(there.statusCode).toBe(401);
    });
  });

  describe('WHEN an agent is made', () => {
    async function makeAgent(displayName = 'Claude'): Promise<string> {
      const response = await command('identity.createAgent', { displayName });

      return response.json<{ id: string }>().id;
    }

    async function issueKey(userId: string, name = 'the laptop'): Promise<string> {
      const response = await command('identity.issueAgentToken', { userId, name });

      return response.json<{ secret: string }>().secret;
    }

    /** A request carrying a key rather than a cookie, as a program would send it. */
    async function asAgent(
      token: string,
      request: { method: 'GET' | 'POST'; url: string; body?: Record<string, unknown> },
    ): Promise<Awaited<ReturnType<typeof server.inject>>> {
      return server.inject({
        method: request.method,
        url: request.url,
        headers: { authorization: `Bearer ${token}` },
        ...(request.body === undefined
          ? {}
          : { payload: { commandId: nextCommandId(), ...request.body } }),
      });
    }

    async function readAgents(): Promise<AgentsView> {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/identity.agents',
        cookies: { lpm_session: ownerCookie },
      });

      return response.json<{ data: AgentsView }>().data;
    }

    it('THEN it is somebody, with its own name and no groups at all', async () => {
      await makeAgent();

      const { agents } = await readAgents();

      expect(agents).toHaveLength(1);
      // Nothing beyond its role's floor. Something that could do everything the
      // moment it existed is a thing somebody has to remember to narrow.
      expect(agents[0]).toMatchObject({ displayName: 'Claude', permissionGroups: [], tokens: [] });
    });

    it('THEN it is not on the people screen, which is for people', async () => {
      await makeAgent();

      const response = await server.inject({
        method: 'GET',
        url: '/api/q/identity.people',
        cookies: { lpm_session: ownerCookie },
      });

      const { people } = response.json<{ data: { people: { displayName: string }[] } }>().data;

      expect(people.map((person) => person.displayName)).not.toContain('Claude');
    });

    it('THEN nothing about it is chosen but its name', async () => {
      /*
       * What somebody may do is decided by the permission groups they hold.
       * Offering a second way to answer that — a role beside it — would give a
       * studio two answers that disagree the first time one is used and not the
       * other, so the command has no field for one and a request carrying one
       * is refused rather than quietly obeyed.
       */
      const response = await command('identity.createAgent', {
        displayName: 'Overreach',
        role: 'owner',
      });

      expect(response.statusCode).toBe(200);

      const made = await testDatabase.database
        .selectFrom('membership')
        .innerJoin('appUser', 'appUser.id', 'membership.userId')
        .select('membership.role')
        .where('appUser.displayName', '=', 'Overreach')
        .executeTakeFirstOrThrow();

      // Asked for the top of the ladder and given the bottom of it, because the
      // command has no field for one: the schema drops what it does not name.
      expect(made.role).toBe('viewer');
    });

    it('THEN it can read and nothing else until somebody allows something', async () => {
      const userId = await makeAgent();
      const token = await issueKey(userId);

      // Reading is the floor it is made at.
      expect((await asAgent(token, { method: 'GET', url: '/api/q/identity.me' })).statusCode).toBe(
        200,
      );

      // Anything past that waits on a permission group.
      const response = await asAgent(token, {
        method: 'POST',
        url: '/api/c/projects.create',
        body: { name: 'Not allowed', code: 'NOPE' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('THEN it cannot sign in, whatever is typed at it', async () => {
      await makeAgent();

      const agent = await testDatabase.database
        .selectFrom('appUser')
        .select('email')
        .where('kind', '=', 'agent')
        .executeTakeFirstOrThrow();

      const response = await server.inject({
        method: 'POST',
        url: '/api/c/identity.signIn',
        // A password shaped like a real one, so this reaches the lookup rather
        // than being turned away by the schema — the point is that the query
        // looking for somebody signing in does not find an agent.
        payload: { commandId: nextCommandId(), email: agent.email, password: PASSWORD },
      });

      expect(response.statusCode).toBe(401);
    });

    it('THEN its key reaches the install, and acts as the agent', async () => {
      const userId = await makeAgent();
      const token = await issueKey(userId);

      const response = await asAgent(token, { method: 'GET', url: '/api/q/identity.me' });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: { user: { id: string } } }>().data.user.id).toBe(userId);
    });

    it('THEN the secret comes back once and is never readable again', async () => {
      const userId = await makeAgent();
      const token = await issueKey(userId);

      expect(token.startsWith('lpm_')).toBe(true);

      // Nothing stores it, so nothing can return it. What is listed is the name,
      // when it was made and when it was last used.
      expect(JSON.stringify(await readAgents())).not.toContain(token);
    });

    it('THEN a revoked key stops working, and stays listed as revoked', async () => {
      const userId = await makeAgent();
      const token = await issueKey(userId);

      const tokenId = (await readAgents()).agents[0]?.tokens[0]?.id;

      await command('identity.revokeAgentToken', { tokenId });

      expect((await asAgent(token, { method: 'GET', url: '/api/q/identity.me' })).statusCode).toBe(
        401,
      );
      expect((await readAgents()).agents[0]?.tokens[0]?.revokedAt).not.toBeNull();
    });

    it('THEN a made-up key reaches nothing', async () => {
      const response = await asAgent('lpm_not-a-real-key', {
        method: 'GET',
        url: '/api/q/identity.me',
      });

      expect(response.statusCode).toBe(401);
    });

    it('THEN a person cannot be given a key, whoever asks', async () => {
      /*
       * A key that acted as a person would be a way around that person's
       * password, and around the trail's answer to who did something.
       */
      const person = await command('identity.createUser', {
        displayName: 'Mira Kaur',
        email: 'mira@northwind.test',
        password: 'a phrase beats a puzzle',
        role: 'member',
      });

      const response = await command('identity.issueAgentToken', {
        userId: person.json<{ id: string }>().id,
        name: 'nope',
      });

      expect(response.statusCode).toBe(422);
    });

    it('THEN it is bound by its permissions like anybody else', async () => {
      // The point of it being a principal: `can` does not know agents exist, so
      // an agent holding no groups is refused exactly as a person would be.
      const userId = await makeAgent();
      const token = await issueKey(userId);

      const response = await asAgent(token, {
        method: 'POST',
        url: '/api/c/identity.createUser',
        body: {
          displayName: 'Somebody',
          email: 'somebody@northwind.test',
          password: 'a phrase beats a puzzle',
          role: 'member',
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('THEN a permission group can be given to it, like anybody', async () => {
      /*
       * The whole of what it may do. `permissions.setUserGroup` takes a user id
       * and never asked what kind of user, so an agent has always been able to
       * hold a group — there was simply nowhere to press.
       */
      const userId = await makeAgent();

      // Made here rather than found: this harness seeds an install directly, so
      // the groups `identity.completeSetup` creates are not there.
      const account = await testDatabase.database
        .selectFrom('membership')
        .select('accountId')
        .executeTakeFirstOrThrow();

      const group = await testDatabase.database
        .insertInto('permissionGroup')
        .values({ accountId: account.accountId, name: 'Board' })
        .returning('id')
        .executeTakeFirstOrThrow();

      await command('permissions.setUserGroup', { userId, groupId: group.id, held: true });

      expect((await readAgents()).agents[0]?.permissionGroups).toHaveLength(1);
    });

    it('THEN somebody can choose its picture, because it cannot choose one itself', async () => {
      const userId = await makeAgent();

      const response = await command('files.requestUpload', {
        target: { kind: 'agentAvatar', userId },
        filename: 'claude.png',
        mime: 'image/png',
        bytes: 128,
      });

      expect(response.statusCode).toBe(200);
    });

    it('THEN a person cannot have their picture chosen for them', async () => {
      /*
       * The exception is narrow on purpose. Somebody else picks an agent's
       * picture only because an agent has no screen to pick one on — a
       * colleague has one, and this is not a way to reach past it.
       */
      const person = await command('identity.createUser', {
        displayName: 'Leo Fenn',
        email: 'leo@northwind.test',
        password: 'a phrase beats a puzzle',
        role: 'member',
      });

      const response = await command('files.requestUpload', {
        target: { kind: 'agentAvatar', userId: person.json<{ id: string }>().id },
        filename: 'leo.png',
        mime: 'image/png',
        bytes: 128,
      });

      expect(response.statusCode).toBe(422);
    });

    it('THEN suspending it stops its keys', async () => {
      const userId = await makeAgent();
      const token = await issueKey(userId);

      await command('identity.setUserStatus', { userId, status: 'suspended' });

      expect((await asAgent(token, { method: 'GET', url: '/api/q/identity.me' })).statusCode).toBe(
        401,
      );
    });
  });
  describe('WHEN there are more people than one page holds', () => {
    beforeEach(async () => {
      // Named so they sort in a known order, and so the search has something to
      // narrow: a page and a bit of them.
      for (let index = 0; index < 52; index += 1) {
        const number = String(index).padStart(3, '0');
        await addPerson(`Person ${number}`, `person${number}@northwind.test`);
      }
    });

    it('THEN a page arrives with the whole count beside it', async () => {
      const page = await readPeople();

      // Fifty-two people plus the admin who added them.
      expect(page.total).toBe(53);
      expect(page.people).toHaveLength(50);
    });

    it('THEN the cursor reaches the rest, without repeating anybody', async () => {
      const first = await readPeople();
      const second = await readPeople(undefined, first.nextCursor ?? undefined);

      const ids = new Set([...first.people, ...second.people].map((person) => person.userId));

      expect(second.nextCursor).toBeNull();
      expect(ids.size).toBe(53);
    });

    it('THEN a search narrows it to the people it matches', async () => {
      const found = await readPeople('person 01');

      expect(found.total).toBe(10);
      expect(found.people.every((person) => person.displayName.startsWith('Person 01'))).toBe(true);
    });

    it('THEN a search matches an email address as well as a name', async () => {
      const found = await readPeople('person007@');

      expect(found.people.map((person) => person.displayName)).toEqual(['Person 007']);
    });
  });
});
