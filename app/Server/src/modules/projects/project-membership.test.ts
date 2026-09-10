import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import type { ProjectCandidatesView, ProjectDetailView, ProjectListView } from '@lpm/shared';
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
  return `018f7777-0000-7000-8000-${String(commandCounter).padStart(12, '0')}`;
}

function readSessionCookie(cookies: readonly { name: string; value: string }[]): string {
  const cookie = cookies.find((candidate) => candidate.name === 'lpm_session');

  if (cookie === undefined) {
    throw new Error('Expected a session cookie to have been set.');
  }

  return cookie.value;
}

describe('GIVEN a project, some people and a team', () => {
  let testDatabase: TestDatabase;
  let server: FastifyInstance;
  let passwordHash: string;
  let ownerCookie: string;
  let ownerId: string;
  let projectId: string;
  let miraId: string;
  let leoId: string;
  let audioId: string;

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

    ownerId = install.userId;
    ownerCookie = await signIn(OWNER_EMAIL);

    miraId = await addPerson('Mira Kaur', 'mira@northwind.test');
    leoId = await addPerson('Leo Tran', 'leo@northwind.test');
    audioId = await makeTeam('Audio');

    const created = await command('projects.create', {
      name: 'Drowned Reach',
      code: 'DRCH',
      phase: 'production',
    });

    projectId = created.json<{ id: string }>().id;
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

  async function query(
    name: string,
    search: string,
    cookie = ownerCookie,
  ): Promise<Awaited<ReturnType<typeof server.inject>>> {
    return server.inject({
      method: 'GET',
      url: `/api/q/${name}${search}`,
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

  async function readProject(cookie = ownerCookie): Promise<ProjectDetailView> {
    const response = await query('projects.detail', '?slug=drowned-reach', cookie);

    return response.json<{ data: ProjectDetailView }>().data;
  }

  async function readLauncher(cookie = ownerCookie): Promise<ProjectListView> {
    const response = await query('projects.list', '', cookie);

    return response.json<{ data: ProjectListView }>().data;
  }

  /** The list a new project comes with, which is where a test card goes. */
  async function firstListOf(): Promise<string> {
    const list = await testDatabase.database
      .selectFrom('list')
      .innerJoin('board', 'board.id', 'list.boardId')
      .select('list.id as id')
      .where('board.projectId', '=', projectId)
      .orderBy('list.position')
      .executeTakeFirstOrThrow();

    return list.id;
  }

  /**
   * A write into the project, by somebody whose role already allows writing.
   *
   * `card.create` needs the role *and* reaching the project, so what it
   * measures here is the reach rather than the rung.
   */
  async function writeACard(cookie: string): Promise<Awaited<ReturnType<typeof server.inject>>> {
    return command(
      'board.createCard',
      { projectId, listId: await firstListOf(), title: 'A card', type: 'task' },
      cookie,
    );
  }

  async function readCandidates(search = '', cookie = ownerCookie): Promise<ProjectCandidatesView> {
    const response = await query(
      'projects.candidates',
      `?projectId=${projectId}&search=${encodeURIComponent(search)}`,
      cookie,
    );

    return response.json<{ data: ProjectCandidatesView }>().data;
  }

  describe('WHEN somebody is put on the project', () => {
    it('THEN they are on its list', async () => {
      await command('projects.addMember', { projectId, userId: miraId });

      const { members } = await readProject();

      expect(members.map((member) => member.displayName)).toEqual(['Jake Winters', 'Mira Kaur']);
    });

    it('THEN the project they could not open before is now on their launcher', async () => {
      const theirCookie = await signIn('mira@northwind.test');

      expect((await readLauncher(theirCookie)).projects).toEqual([]);

      await command('projects.addMember', { projectId, userId: miraId });

      expect((await readLauncher(theirCookie)).projects).toEqual([
        expect.objectContaining({ name: 'Drowned Reach' }),
      ]);
    });

    it('THEN the trail records who was put on it', async () => {
      await command('projects.addMember', { projectId, userId: miraId });

      const event = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .where('name', '=', 'projects.memberAdded')
        .executeTakeFirstOrThrow();

      expect(event).toMatchObject({
        aggregateType: 'project',
        aggregateId: projectId,
        actorId: ownerId,
      });
      expect(event.payload).toMatchObject({ displayName: 'Mira Kaur' });
    });

    it('THEN adding them again leaves them on it once, rather than refusing', async () => {
      await command('projects.addMember', { projectId, userId: miraId });

      const response = await command('projects.addMember', { projectId, userId: miraId });
      const { members } = await readProject();

      expect(response.statusCode).toBe(200);
      expect(members.filter((member) => member.userId === miraId)).toHaveLength(1);
    });

    it('THEN a second press does not take the project off whoever made it', async () => {
      await command('projects.addMember', { projectId, userId: ownerId });

      const stored = await testDatabase.database
        .selectFrom('projectMember')
        .select('role')
        .where('projectId', '=', projectId)
        .where('userId', '=', ownerId)
        .executeTakeFirstOrThrow();

      expect(stored.role).toBe('owner');
    });

    it('THEN they work in a project that did not exist for them a moment ago', async () => {
      const theirCookie = await signIn('mira@northwind.test');
      const before = await writeACard(theirCookie);

      await command('projects.addMember', { projectId, userId: miraId });

      const opened = await query('projects.detail', '?slug=drowned-reach', theirCookie);
      const after = await writeACard(theirCookie);

      // Nothing about what Mira may do changed — her groups and her role say
      // that, and they said it before. What changed is where she may do it.
      expect(before.statusCode).toBe(404);
      expect(opened.statusCode).toBe(200);
      expect(after.statusCode).toBe(200);
    });

    it('THEN somebody who is not on the install cannot be put on the project', async () => {
      const response = await command('projects.addMember', {
        projectId,
        userId: '018f0000-0000-7000-8000-00000000dead',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json<{ message: string }>().message).toContain('nobody here');
    });
  });

  describe('WHEN somebody is taken off the project', () => {
    beforeEach(async () => {
      await command('projects.addMember', { projectId, userId: miraId });
    });

    it('THEN they are off its list and it is off their launcher', async () => {
      const theirCookie = await signIn('mira@northwind.test');

      await command('projects.removeMember', { projectId, userId: miraId });

      const { members } = await readProject();

      expect(members.map((member) => member.userId)).toEqual([ownerId]);
      expect((await readLauncher(theirCookie)).projects).toEqual([]);
    });

    it('THEN taking off somebody who was never on it changes nothing and does not fail', async () => {
      const response = await command('projects.removeMember', { projectId, userId: leoId });

      expect(response.statusCode).toBe(200);
      expect((await readProject()).members).toHaveLength(2);
    });

    it('THEN the trail records who came off', async () => {
      await command('projects.removeMember', { projectId, userId: miraId });

      const event = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .where('name', '=', 'projects.memberRemoved')
        .executeTakeFirstOrThrow();

      expect(event.payload).toMatchObject({ displayName: 'Mira Kaur' });
    });
  });

  describe('WHEN a team is put on the project', () => {
    beforeEach(async () => {
      await command('teams.addMember', { teamId: audioId, userId: miraId });
      await command('projects.addTeam', { projectId, teamId: audioId });
    });

    it('THEN it is on the project with the head count it brings', async () => {
      const { teams } = await readProject();

      expect(teams).toEqual([
        expect.objectContaining({ teamId: audioId, name: 'Audio', memberCount: 1 }),
      ]);
    });

    it('THEN everybody in it reaches the project without being named on it', async () => {
      const theirCookie = await signIn('mira@northwind.test');
      const detail = await readProject();

      expect((await readLauncher(theirCookie)).projects).toEqual([
        expect.objectContaining({ name: 'Drowned Reach' }),
      ]);
      // Reached through the team, and so not on the list of people who have a
      // row of their own to take off.
      expect(detail.members.map((member) => member.userId)).toEqual([ownerId]);
    });

    it('THEN somebody who joins the team afterwards reaches it too', async () => {
      const theirCookie = await signIn('leo@northwind.test');

      expect((await readLauncher(theirCookie)).projects).toEqual([]);

      await command('teams.addMember', { teamId: audioId, userId: leoId });

      expect((await readLauncher(theirCookie)).projects).toHaveLength(1);
    });

    it('THEN leaving the team takes the project away again', async () => {
      const theirCookie = await signIn('mira@northwind.test');

      await command('teams.removeMember', { teamId: audioId, userId: miraId });

      expect((await readLauncher(theirCookie)).projects).toEqual([]);
    });

    it('THEN the tile counts everybody once, however many ways they reach it', async () => {
      await command('projects.addMember', { projectId, userId: miraId });

      const [project] = (await readLauncher()).projects;

      // Jake, who made it, and Mira — who is on it by name and in the team.
      expect(project?.counts.team).toBe(2);
    });

    it('THEN its people work in the project without a row of their own', async () => {
      const theirCookie = await signIn('mira@northwind.test');

      const opened = await query('projects.detail', '?slug=drowned-reach', theirCookie);
      const written = await writeACard(theirCookie);

      expect(opened.statusCode).toBe(200);
      expect(written.statusCode).toBe(200);
      expect((await readProject()).members.map((member) => member.userId)).toEqual([ownerId]);
    });

    it('THEN putting it on again leaves it on once', async () => {
      const response = await command('projects.addTeam', { projectId, teamId: audioId });

      expect(response.statusCode).toBe(200);
      expect((await readProject()).teams).toHaveLength(1);
    });

    it('THEN taking the team off takes the reach with it', async () => {
      const theirCookie = await signIn('mira@northwind.test');

      await command('projects.removeTeam', { projectId, teamId: audioId });

      expect((await readProject()).teams).toEqual([]);
      expect((await readLauncher(theirCookie)).projects).toEqual([]);
    });

    it('THEN somebody also on it by name keeps the project when the team comes off', async () => {
      await command('projects.addMember', { projectId, userId: miraId });
      const theirCookie = await signIn('mira@northwind.test');

      await command('projects.removeTeam', { projectId, teamId: audioId });

      expect((await readLauncher(theirCookie)).projects).toHaveLength(1);
    });

    it('THEN a team from no install this account knows about is not found', async () => {
      const response = await command('projects.addTeam', {
        projectId,
        teamId: '018f0000-0000-7000-8000-00000000beef',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json<{ message: string }>().message).toContain('no team here');
    });

    it('THEN the trail records the team going on and coming off', async () => {
      await command('projects.removeTeam', { projectId, teamId: audioId });

      const events = await testDatabase.database
        .selectFrom('domainEvent')
        .select(['name', 'payload'])
        .where('name', 'in', ['projects.teamAdded', 'projects.teamRemoved'])
        .orderBy('occurredAt')
        .execute();

      expect(events.map((event) => event.name)).toEqual([
        'projects.teamAdded',
        'projects.teamRemoved',
      ]);
    });
  });

  describe('WHEN a deleted team is put back', () => {
    it('THEN it is on the projects it was on, so its people reach them again', async () => {
      await command('teams.addMember', { teamId: audioId, userId: miraId });
      await command('projects.addTeam', { projectId, teamId: audioId });
      await command('teams.delete', { teamId: audioId });

      const binned = await testDatabase.database
        .selectFrom('deletedThing')
        .select('id')
        .executeTakeFirstOrThrow();

      await command('recovery.restore', { deletedThingId: binned.id });

      const theirCookie = await signIn('mira@northwind.test');

      expect((await readProject()).teams).toHaveLength(1);
      expect((await readLauncher(theirCookie)).projects).toHaveLength(1);
    });
  });

  describe('WHEN the picker asks what is left to add', () => {
    it('THEN it offers the people and teams that are not on the project yet', async () => {
      const candidates = await readCandidates();

      expect(candidates.people.map((person) => person.displayName)).toEqual([
        'Leo Tran',
        'Mira Kaur',
      ]);
      expect(candidates.teams.map((team) => team.name)).toEqual(['Audio']);
    });

    it('THEN somebody already on it by name is no longer offered', async () => {
      await command('projects.addMember', { projectId, userId: miraId });

      const candidates = await readCandidates();

      expect(candidates.people.map((person) => person.userId)).not.toContain(miraId);
    });

    it('THEN a team already on it is no longer offered', async () => {
      await command('projects.addTeam', { projectId, teamId: audioId });

      expect((await readCandidates()).teams).toEqual([]);
    });

    it('THEN a search narrows both lists, and says the person is in a team', async () => {
      await command('teams.addMember', { teamId: audioId, userId: miraId });

      const candidates = await readCandidates('mira');

      expect(candidates.people).toEqual([
        expect.objectContaining({ displayName: 'Mira Kaur', teams: ['Audio'] }),
      ]);
      expect(candidates.teams).toEqual([]);
    });

    it('THEN a lead who may staff a project can use it without the keys to the install', async () => {
      await addPerson('Ada Brook', 'ada@northwind.test', 'lead');
      const theirCookie = await signIn('ada@northwind.test');

      const people = await query('identity.people', '', theirCookie);
      const candidates = await query('projects.candidates', `?projectId=${projectId}`, theirCookie);

      expect(people.statusCode).toBe(403);
      expect(candidates.statusCode).toBe(200);
    });

    it('THEN somebody who cannot reach the project is told it does not exist', async () => {
      const theirCookie = await signIn('mira@northwind.test');

      const response = await query('projects.candidates', `?projectId=${projectId}`, theirCookie);

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN somebody without the permission tries to staff a project', () => {
    it('THEN a member on the project is refused, because staffing is not writing', async () => {
      await command('projects.addMember', { projectId, userId: miraId });
      const theirCookie = await signIn('mira@northwind.test');

      const response = await command(
        'projects.addMember',
        { projectId, userId: leoId },
        theirCookie,
      );

      expect(response.statusCode).toBe(403);
    });

    it('THEN somebody off the project is told there is no such project', async () => {
      const theirCookie = await signIn('mira@northwind.test');

      const response = await command(
        'projects.addMember',
        { projectId, userId: leoId },
        theirCookie,
      );

      // Not 403: being refused about a project is how somebody learns it exists.
      expect(response.statusCode).toBe(404);
    });

    it('THEN a visitor with no session is turned away before any of that', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/c/projects.addTeam',
        payload: { commandId: nextCommandId(), projectId, teamId: audioId },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('WHEN the project has been archived', () => {
    beforeEach(async () => {
      await command('projects.archive', { projectId });
    });

    it('THEN nobody is put on it, because nothing about it is being changed', async () => {
      const response = await command('projects.addMember', {
        projectId,
        userId: miraId,
      });
      const failure = response.json<{ code: string; message: string }>();

      expect(failure.code).toBe('INVARIANT_VIOLATED');
      expect(failure.message).toContain('archived');
    });

    it('THEN no team goes on it either', async () => {
      const response = await command('projects.addTeam', {
        projectId,
        teamId: audioId,
      });

      expect(response.json<{ code: string }>().code).toBe('INVARIANT_VIOLATED');
    });
  });
});
