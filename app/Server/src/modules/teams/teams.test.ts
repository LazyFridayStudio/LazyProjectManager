import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import type { PeopleView, TeamListView } from '@lpm/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

describe('GIVEN an install with an admin and a few people on it', () => {
  let testDatabase: TestDatabase;
  let server: FastifyInstance;
  let passwordHash: string;
  let ownerCookie: string;
  let miraId: string;
  let leoId: string;

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

    await seedInstall(testDatabase.database, {
      email: OWNER_EMAIL,
      passwordHash,
      displayName: 'Jake Winters',
    });

    ownerCookie = await signIn(OWNER_EMAIL);
    miraId = await addPerson('Mira Kaur', 'mira@northwind.test');
    leoId = await addPerson('Leo Tran', 'leo@northwind.test');
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

  async function addPerson(displayName: string, email: string, role = 'member'): Promise<string> {
    const response = await command('identity.createUser', {
      email,
      displayName,
      role,
      password: PASSWORD,
    });

    return response.json<{ id: string }>().id;
  }

  async function makeTeam(name: string): Promise<string> {
    const response = await command('teams.create', { name });

    return response.json<{ id: string }>().id;
  }

  async function readTeams(cookie = ownerCookie): Promise<TeamListView> {
    const response = await server.inject({
      method: 'GET',
      url: '/api/q/teams.list',
      cookies: { lpm_session: cookie },
    });

    return response.json<{ data: TeamListView }>().data;
  }

  async function readPeople(query: string): Promise<PeopleView> {
    const response = await server.inject({
      method: 'GET',
      url: `/api/q/identity.people?${query}`,
      cookies: { lpm_session: ownerCookie },
    });

    return response.json<{ data: PeopleView }>().data;
  }

  describe('WHEN a team is made', () => {
    it('THEN it is on the list, with nobody in it and nobody leading it', async () => {
      await makeTeam('Environment art');

      const [team] = (await readTeams()).teams;

      expect(team).toMatchObject({ name: 'Environment art', memberCount: 0, lead: null });
      expect(team?.faces).toEqual([]);
    });

    it('THEN a second team by the same name, in any case, is refused on the field', async () => {
      await makeTeam('Environment art');

      const response = await command('teams.create', { name: 'ENVIRONMENT ART' });
      const failure = response.json<{ code: string; fields?: Record<string, string> }>();

      expect(failure.code).toBe('CONFLICT');
      expect(failure.fields?.name).toBe('That name is taken.');
    });

    it('THEN the teams come back in alphabetical order, whatever order they were made in', async () => {
      await makeTeam('Sound');
      await makeTeam('Animation');
      await makeTeam('Environment art');

      expect((await readTeams()).teams.map((team) => team.name)).toEqual([
        'Animation',
        'Environment art',
        'Sound',
      ]);
    });
  });

  describe('WHEN somebody who is not an admin looks at the teams', () => {
    it('THEN they are refused', async () => {
      await addPerson('Ada Lead', 'ada@northwind.test', 'lead');
      const theirCookie = await signIn('ada@northwind.test');

      const response = await server.inject({
        method: 'GET',
        url: '/api/q/teams.list',
        cookies: { lpm_session: theirCookie },
      });

      expect(response.statusCode).toBe(403);
    });

    it('THEN they cannot make one either', async () => {
      await addPerson('Ada Lead', 'ada@northwind.test', 'lead');
      const theirCookie = await signIn('ada@northwind.test');

      const response = await command('teams.create', { name: 'Sneaky' }, theirCookie);

      expect(response.statusCode).toBe(403);
    });
  });

  describe('WHEN people are put in a team', () => {
    let teamId: string;

    beforeEach(async () => {
      teamId = await makeTeam('Environment art');
      await command('teams.addMember', { teamId, userId: miraId });
    });

    it('THEN the tile counts them and shows their initials', async () => {
      const [team] = (await readTeams()).teams;

      expect(team?.memberCount).toBe(1);
      expect(team?.faces.map((face) => face.initials)).toEqual(['MK']);
    });

    it('THEN adding the same person again changes nothing', async () => {
      await command('teams.addMember', { teamId, userId: miraId });

      expect((await readTeams()).teams[0]?.memberCount).toBe(1);
    });

    it('THEN the team can be asked for its own members', async () => {
      const inTeam = await readPeople(`inTeamId=${teamId}`);

      expect(inTeam.people.map((person) => person.displayName)).toEqual(['Mira Kaur']);
    });

    it('THEN everybody else is who a picker offers', async () => {
      const notInTeam = await readPeople(`notInTeamId=${teamId}`);

      expect(notInTeam.people.map((person) => person.displayName)).toEqual([
        'Jake Winters',
        'Leo Tran',
      ]);
    });

    it('THEN the people list says which teams somebody is in', async () => {
      const anotherId = await makeTeam('Sound');
      await command('teams.addMember', { teamId: anotherId, userId: miraId });

      const listed = (await readPeople('')).people.find(
        (person) => person.displayName === 'Mira Kaur',
      );

      expect(listed?.teams).toEqual(['Environment art', 'Sound']);
    });

    it('THEN taking somebody out leaves the team and the person alone', async () => {
      await command('teams.removeMember', { teamId, userId: miraId });

      const stillHere = await readPeople('search=Mira');

      expect((await readTeams()).teams[0]?.memberCount).toBe(0);
      expect(stillHere.people).toHaveLength(1);
    });
  });

  describe('WHEN a team is given a lead', () => {
    it('THEN the tile says who it is', async () => {
      const teamId = await makeTeam('Environment art');
      await command('teams.addMember', { teamId, userId: leoId });

      await command('teams.update', { teamId, leadUserId: leoId });

      expect((await readTeams()).teams[0]?.lead).toMatchObject({ displayName: 'Leo Tran' });
    });

    it('THEN the lead can be taken away again without taking the team', async () => {
      const teamId = await makeTeam('Environment art');
      await command('teams.update', { teamId, leadUserId: leoId });

      await command('teams.update', { teamId, leadUserId: null });

      expect((await readTeams()).teams[0]?.lead).toBeNull();
    });

    it('THEN somebody from another install cannot be made the lead', async () => {
      const teamId = await makeTeam('Environment art');

      const response = await command('teams.update', {
        teamId,
        leadUserId: '018f9999-0000-7000-8000-000000000004',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN a team is renamed', () => {
    it('THEN the new name is what the list says', async () => {
      const teamId = await makeTeam('Environment art');

      await command('teams.update', { teamId, name: 'Environments' });

      expect((await readTeams()).teams[0]?.name).toBe('Environments');
    });

    it('THEN a change with nothing in it writes nothing', async () => {
      const teamId = await makeTeam('Environment art');

      await command('teams.update', { teamId, name: 'Environment art' });

      const events = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .where('name', '=', 'teams.updated')
        .execute();

      expect(events).toHaveLength(0);
    });
  });

  describe('WHEN a team is removed', () => {
    it('THEN it goes, and the people in it stay', async () => {
      const teamId = await makeTeam('Environment art');
      await command('teams.addMember', { teamId, userId: miraId });

      await command('teams.delete', { teamId });

      const stillHere = await readPeople('search=Mira');

      expect((await readTeams()).teams).toHaveLength(0);
      expect(stillHere.people).toHaveLength(1);
      expect(stillHere.people[0]?.teams).toEqual([]);
    });

    it('THEN a team from another install is not found', async () => {
      const response = await command('teams.delete', {
        teamId: '018f9999-0000-7000-8000-000000000005',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN the trail is read afterwards', () => {
    it('THEN it names the team each entry was about', async () => {
      const teamId = await makeTeam('Environment art');
      await command('teams.addMember', { teamId, userId: miraId });

      const response = await server.inject({
        method: 'GET',
        url: '/api/q/audit.trail',
        cookies: { lpm_session: ownerCookie },
      });
      const entries = response.json<{
        data: { entries: { name: string; subject: { kind: string; label: string | null } }[] };
      }>().data.entries;
      const added = entries.find((entry) => entry.name === 'teams.memberAdded');

      expect(added?.subject).toMatchObject({ kind: 'team', label: 'Environment art' });
    });

    it('THEN an entry about a person names the person', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/audit.trail',
        cookies: { lpm_session: ownerCookie },
      });
      const entries = response.json<{
        data: { entries: { name: string; subject: { label: string | null } }[] };
      }>().data.entries;
      const created = entries.find((entry) => entry.name === 'identity.userCreated');

      expect(created?.subject.label).toBe('Leo Tran');
    });
  });
});
