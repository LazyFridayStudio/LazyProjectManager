import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import {
  TIMELINE_DAYS,
  type ProjectDetailView,
  type MilestonePlanView,
  type ProjectListView,
  type ProjectTimelineView,
} from '@lpm/shared';
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

/** Redis is not on the projects path; a stub keeps these tests to one dependency. */
/**
 * Enough of Redis for a server to start: a health probe, and the subscriber the
 * realtime hub opens. Nothing publishes in these tests, so nothing arrives.
 */
let commandCounter = 0;

/** A fresh id per call, so nothing collides with the idempotency ledger. */
function nextCommandId(): string {
  commandCounter += 1;
  return `018f1111-0000-7000-8000-${String(commandCounter).padStart(12, '0')}`;
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

function getQuery(name: string, search: string, sessionCookie?: string): InjectOptions {
  return {
    method: 'GET',
    url: `/api/q/${name}${search}`,
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

describe('GIVEN an install with a signed-in owner', () => {
  let testDatabase: TestDatabase;
  let server: FastifyInstance;
  let passwordHash: string;
  let accountId: string;
  let ownerId: string;
  let ownerCookie: string;

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
    ownerId = install.userId;
    ownerCookie = await signIn(OWNER_EMAIL);
  });

  async function signIn(email: string): Promise<string> {
    const response = await server.inject(
      postCommand('identity.signIn', { email, password: PASSWORD }),
    );

    return readSessionCookie(response.cookies);
  }

  /**
   * Another person on the same account, so role rules can be exercised.
   *
   * Named, because the timeline orders its rows by display name and a test that
   * asserts on that order cannot have three people all called Team Mate.
   */
  async function seedTeammate(
    role: MembershipRole,
    email: string,
    displayName = 'Team Mate',
  ): Promise<string> {
    const user = await testDatabase.database
      .insertInto('appUser')
      .values({
        email,
        passwordHash,
        displayName,
        initials: displayName.slice(0, 2).toUpperCase(),
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

  async function createProject(
    body: Record<string, unknown>,
    sessionCookie = ownerCookie,
  ): Promise<{ id: string }> {
    const response = await server.inject(postCommand('projects.create', body, sessionCookie));
    const json = response.json<{ ok: boolean; id?: string; code?: string }>();

    if (!json.ok || json.id === undefined) {
      throw new Error(`Expected the project to be created, got ${JSON.stringify(json)}.`);
    }

    return { id: json.id };
  }

  /** The list a new project comes with, which is where a test card goes. */
  async function firstListOf(projectId: string): Promise<string> {
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
   * Closes a card the only way the product does: by moving it to the end.
   *
   * The list a card sits in is what says whether it is finished, so a test that
   * set a flag instead would be proving something no screen can do.
   */
  async function closeCard(projectId: string, cardId: string): Promise<void> {
    const finishing = await testDatabase.database
      .selectFrom('list')
      .innerJoin('board', 'board.id', 'list.boardId')
      .select('list.id as id')
      .where('board.projectId', '=', projectId)
      .where('list.archivedAt', 'is', null)
      .orderBy('list.position', 'desc')
      .executeTakeFirstOrThrow();

    await server.inject(
      postCommand('board.moveCard', { cardId, toListId: finishing.id }, ownerCookie),
    );
  }

  async function listProjects(search = '', sessionCookie = ownerCookie): Promise<ProjectListView> {
    const response = await server.inject(getQuery('projects.list', search, sessionCookie));

    return response.json<{ data: ProjectListView }>().data;
  }

  describe('WHEN a project is created with everything filled in', () => {
    beforeEach(async () => {
      await createProject({
        name: 'Drowned Reach',
        code: 'drch',
        engine: 'Unreal 5.5',
        phase: 'vertical_slice',
        budgetMinor: 64_000_000,
        startsOn: '2026-01-05',
        shipsOn: '2026-11-30',
      });
    });

    it('THEN the project is stored with an upper-case code and a derived address', async () => {
      const project = await testDatabase.database
        .selectFrom('project')
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(project).toMatchObject({
        name: 'Drowned Reach',
        code: 'DRCH',
        slug: 'drowned-reach',
        engine: 'Unreal 5.5',
        phase: 'vertical_slice',
        currency: 'AUD',
        datesTbd: false,
      });
    });

    it('THEN the dates come back as calendar days, not as shifted instants', async () => {
      const project = await testDatabase.database
        .selectFrom('project')
        .select(['startsOn', 'shipsOn'])
        .executeTakeFirstOrThrow();

      // The default `pg` parser builds a Date at local midnight, which reads back
      // as the day before for anyone west of the server.
      expect(project.startsOn).toBe('2026-01-05');
      expect(project.shipsOn).toBe('2026-11-30');
    });

    it('THEN the budget survives as exact minor units', async () => {
      const { projects } = await listProjects();

      expect(projects[0]).toMatchObject({ budgetMinor: 64_000_000, currency: 'AUD' });
    });

    it('THEN every card sequence exists, so the project can issue keys immediately', async () => {
      const sequences = await testDatabase.database
        .selectFrom('cardSequence')
        .select(['prefix', 'lastValue'])
        .orderBy('prefix')
        .execute();

      expect(sequences).toEqual([
        { prefix: 'ART', lastValue: 0 },
        { prefix: 'BUG', lastValue: 0 },
        { prefix: 'BUILD', lastValue: 0 },
        { prefix: 'TASK', lastValue: 0 },
      ]);
    });

    it('THEN the person who made it is its first member, as its owner', async () => {
      const member = await testDatabase.database
        .selectFrom('projectMember')
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(member).toMatchObject({ userId: ownerId, role: 'owner' });
    });

    it('THEN a projectCreated event is appended for the outbox to carry', async () => {
      const event = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .where('name', '=', 'projects.projectCreated')
        .executeTakeFirstOrThrow();

      expect(event).toMatchObject({
        aggregateType: 'project',
        accountId,
        actorId: ownerId,
      });
      expect(event.payload).toMatchObject({
        name: 'Drowned Reach',
        code: 'DRCH',
        slug: 'drowned-reach',
      });
    });

    it('THEN the launcher shows it with the counts the tile renders', async () => {
      const { projects } = await listProjects();

      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject({
        name: 'Drowned Reach',
        code: 'DRCH',
        role: 'owner',
        // A project nobody has put anything in yet, which is three zeroes and
        // the person who made it.
        counts: { assets: 0, openTasks: 0, team: 1 },
      });
    });

    it('THEN the settings screen can be opened at the project address', async () => {
      const response = await server.inject(
        getQuery('projects.detail', '?slug=drowned-reach', ownerCookie),
      );
      const detail = response.json<{ data: ProjectDetailView }>().data;

      expect(detail.project.code).toBe('DRCH');
      expect(detail.members).toEqual([
        expect.objectContaining({ userId: ownerId, displayName: 'Jake Winters', role: 'owner' }),
      ]);
      // The number a person is about to see on a card, not the last one used.
      expect(detail.sequences).toEqual([
        { prefix: 'ART', nextValue: 1 },
        { prefix: 'BUG', nextValue: 1 },
        { prefix: 'BUILD', nextValue: 1 },
        { prefix: 'TASK', nextValue: 1 },
      ]);
    });
  });

  describe('WHEN there is work and a library on a project', () => {
    it('THEN the tile counts them, rather than saying nought whatever is there', async () => {
      const { id } = await createProject({ name: 'Drowned Reach', code: 'DRCH' });
      const listId = await firstListOf(id);

      for (const title of ['Retopologise the watchtower', 'Fix the tide shader']) {
        await server.inject(
          postCommand(
            'board.createCard',
            { projectId: id, listId, title, type: 'art' },
            ownerCookie,
          ),
        );
      }

      const category = await testDatabase.database
        .insertInto('assetCategory')
        .values({
          accountId,
          projectId: id,
          name: 'Environment Props',
          color: '#adadad',
          position: 1000,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await testDatabase.database
        .insertInto('asset')
        .values({
          accountId,
          projectId: id,
          categoryId: category.id,
          name: 'Ruined watchtower',
          assetKey: 'DRCH-AST-1',
          position: 1000,
        })
        .execute();

      const { projects } = await listProjects();

      expect(projects[0]?.counts).toEqual({ assets: 1, openTasks: 2, team: 1 });
    });

    it('THEN closing a card takes it off the count, which only open work is on', async () => {
      const { id } = await createProject({ name: 'Drowned Reach', code: 'DRCH' });
      const listId = await firstListOf(id);
      const created = await server.inject(
        postCommand(
          'board.createCard',
          { projectId: id, listId, title: 'Retopologise the watchtower', type: 'art' },
          ownerCookie,
        ),
      );

      await testDatabase.database
        .updateTable('card')
        .set({ closedAt: new Date() })
        .where('id', '=', created.json<{ id: string }>().id)
        .execute();

      // A number that counted finished work would only ever grow, which makes
      // it a number nobody reads twice.
      expect((await listProjects()).projects[0]?.counts.openTasks).toBe(0);
    });
  });

  describe('WHEN a project has been given a logo', () => {
    /** A file with a thumbnail, which is the state a resized picture is in. */
    async function giveLogo(projectId: string): Promise<void> {
      const file = await testDatabase.database
        .insertInto('file')
        .values({
          accountId,
          storageKey: 'account/logo.png',
          filename: 'logo.png',
          mime: 'image/png',
          bytes: 1_000,
          state: 'stored',
          thumbnailKey: 'account/logo.png.thumb.webp',
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await testDatabase.database
        .updateTable('project')
        .set({ logoFileId: file.id })
        .where('id', '=', projectId)
        .execute();
    }

    it('THEN the sidebar is given a link to it, so every screen draws the mark', async () => {
      const { id } = await createProject({ name: 'Drowned Reach', code: 'DRCH' });
      await giveLogo(id);

      const response = await server.inject(
        getQuery('projects.workspace', '?slug=drowned-reach', ownerCookie),
      );

      // The file's own address on this server. What comes back from it is the
      // thumbnail — the mark is drawn at thirty pixels and the file behind it
      // can be a print-resolution logo — but that is the route's business.
      expect(
        response.json<{ data: { project: { logoUrl: string | null } } }>().data.project.logoUrl,
      ).toMatch(/^\/api\/f\/[0-9a-f-]{36}$/u);
    });

    it('THEN the Tasks badge counts what is left, and falls as the board is cleared', async () => {
      const { id } = await createProject({ name: 'Drowned Reach', code: 'DRCH' });
      const listId = await firstListOf(id);

      const cardId = await server
        .inject(
          postCommand(
            'board.createCard',
            { projectId: id, listId, title: 'Retopologise the watchtower', type: 'art' },
            ownerCookie,
          ),
        )
        .then((response) => response.json<{ id: string }>().id);

      async function taskCount(): Promise<number | undefined> {
        const response = await server.inject(
          getQuery('projects.workspace', '?slug=drowned-reach', ownerCookie),
        );

        return response.json<{ data: { openCardCount: number } }>().data.openCardCount;
      }

      expect(await taskCount()).toBe(1);

      // Dropped in the last list, which is the only thing that finishes a card.
      await closeCard(id, cardId);

      // The number nobody read twice, now readable: a badge over finished work
      // would only ever have gone up.
      expect(await taskCount()).toBe(0);
    });

    it('THEN a project without one says so, rather than pointing at nothing', async () => {
      await createProject({ name: 'Kiln', code: 'KILN' });

      const response = await server.inject(
        getQuery('projects.workspace', '?slug=kiln', ownerCookie),
      );

      expect(
        response.json<{ data: { project: { logoUrl: string | null } } }>().data.project.logoUrl,
      ).toBeNull();
    });

    it('THEN the launcher and the settings screen are given it too', async () => {
      const { id } = await createProject({ name: 'Drowned Reach', code: 'DRCH' });
      await giveLogo(id);

      const detail = await server.inject(
        getQuery('projects.detail', '?slug=drowned-reach', ownerCookie),
      );
      const { projects } = await listProjects();

      // Both read the same summary, so the tile and the settings preview
      // cannot disagree about what a project looks like.
      const fromSettings = detail.json<{ data: ProjectDetailView }>().data.project.logoUrl;

      expect(fromSettings).toMatch(/^\/api\/f\/[0-9a-f-]{36}$/u);
      expect(projects[0]?.logoUrl).toBe(fromSettings);
      // The pictures are separate: a logo is not a crop of the key art.
      expect(projects[0]?.keyArtUrl).toBeNull();
    });
  });

  describe('WHEN a project is created with no dates', () => {
    it('THEN it is marked as having none, rather than looking overdue', async () => {
      await createProject({ name: 'Kiln', code: 'KILN' });

      const project = await testDatabase.database
        .selectFrom('project')
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(project).toMatchObject({
        datesTbd: true,
        startsOn: null,
        shipsOn: null,
        budgetMinor: null,
        phase: 'prototype',
      });
    });
  });

  describe('WHEN a project is created that would ship before it starts', () => {
    it('THEN it is refused, and nothing is written', async () => {
      const response = await server.inject(
        postCommand(
          'projects.create',
          {
            name: 'Backwards',
            code: 'BKWD',
            startsOn: '2026-11-30',
            shipsOn: '2026-01-05',
          },
          ownerCookie,
        ),
      );

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        code: 'INVARIANT_VIOLATED',
        fields: { shipsOn: expect.any(String) as unknown },
      });
      await expect(
        testDatabase.database.selectFrom('project').selectAll().execute(),
      ).resolves.toHaveLength(0);
    });
  });

  describe('WHEN a second project reuses a code', () => {
    it('THEN it is refused, naming the field the form should highlight', async () => {
      await createProject({ name: 'Kiln', code: 'KILN' });

      const response = await server.inject(
        postCommand('projects.create', { name: 'Kiln Two', code: 'KILN' }, ownerCookie),
      );

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 'CONFLICT',
        fields: { code: expect.any(String) as unknown },
      });
    });
  });

  describe('WHEN a second project reuses a name', () => {
    it('THEN it gets its own address, disambiguated by its code', async () => {
      await createProject({ name: 'Kiln', code: 'KILN' });
      await createProject({ name: 'Kiln', code: 'KLN2' });

      const slugs = await testDatabase.database
        .selectFrom('project')
        .select('slug')
        .orderBy('slug')
        .execute();

      expect(slugs.map((row) => row.slug)).toEqual(['kiln', 'kiln-kln2']);
    });
  });

  describe('WHEN the same create command is sent twice', () => {
    it('THEN the second is a no-op, because a retry must not make two projects', async () => {
      const commandId = nextCommandId();
      const body = { commandId, name: 'Saltmarsh', code: 'SLTM' };

      await server.inject(postCommand('projects.create', body, ownerCookie));
      const replay = await server.inject(postCommand('projects.create', body, ownerCookie));

      expect(replay.json()).toMatchObject({ ok: true });
      await expect(
        testDatabase.database.selectFrom('project').selectAll().execute(),
      ).resolves.toHaveLength(1);
    });
  });

  describe('WHEN a project is edited from its settings screen', () => {
    let projectId: string;

    beforeEach(async () => {
      const created = await createProject({
        name: 'Kiln',
        code: 'KILN',
        startsOn: '2026-01-05',
        shipsOn: '2026-11-30',
      });

      projectId = created.id;
    });

    it('THEN only the fields that were sent change', async () => {
      await server.inject(
        postCommand('projects.update', { projectId, phase: 'alpha' }, ownerCookie),
      );

      const project = await testDatabase.database
        .selectFrom('project')
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(project).toMatchObject({ phase: 'alpha', name: 'Kiln', shipsOn: '2026-11-30' });
    });

    it('THEN a field sent as null is cleared', async () => {
      await server.inject(
        postCommand('projects.update', { projectId, engine: null, shipsOn: null }, ownerCookie),
      );

      const project = await testDatabase.database
        .selectFrom('project')
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(project).toMatchObject({ engine: null, shipsOn: null });
    });

    it('THEN the event records what moved without repeating the values', async () => {
      await server.inject(
        postCommand('projects.update', { projectId, budgetMinor: 31_000_000 }, ownerCookie),
      );

      const event = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .where('name', '=', 'projects.projectUpdated')
        .executeTakeFirstOrThrow();

      expect(event.payload).toMatchObject({ changedFields: ['budgetMinor'] });
      expect(JSON.stringify(event.payload)).not.toContain('31000000');
    });

    it('THEN an update with nothing in it writes nothing at all', async () => {
      await server.inject(postCommand('projects.update', { projectId }, ownerCookie));

      const events = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .where('name', '=', 'projects.projectUpdated')
        .execute();

      expect(events).toHaveLength(0);
    });

    it('THEN the sections a project does not use are stored, and nothing is deleted', async () => {
      const listId = await firstListOf(projectId);
      await server.inject(
        postCommand(
          'board.createCard',
          { projectId, listId, title: 'Retopologise the watchtower', type: 'art' },
          ownerCookie,
        ),
      );

      await server.inject(
        postCommand(
          'projects.update',
          { projectId, disabledSections: ['timeline', 'budget', 'timeline'] },
          ownerCookie,
        ),
      );

      const project = await testDatabase.database
        .selectFrom('project')
        .select('disabledSections')
        .where('id', '=', projectId)
        .executeTakeFirstOrThrow();

      // The set, not the words as they arrived: a section is off or it is not.
      expect(project.disabledSections).toEqual(['timeline', 'budget']);

      // Off is not delete. The work is exactly where it was.
      const cards = await testDatabase.database.selectFrom('card').select('id').execute();
      expect(cards).toHaveLength(1);
    });

    it('THEN a section that cannot be switched off is refused rather than stored', async () => {
      const response = await server.inject(
        postCommand('projects.update', { projectId, disabledSections: ['settings'] }, ownerCookie),
      );

      // Refused by the schema, so Settings cannot take away the switch that
      // would turn it back on.
      expect(response.statusCode).toBe(422);

      const project = await testDatabase.database
        .selectFrom('project')
        .select('disabledSections')
        .where('id', '=', projectId)
        .executeTakeFirstOrThrow();

      expect(project.disabledSections).toEqual([]);
    });

    it('THEN moving only the ship date is still checked against the existing start', async () => {
      const response = await server.inject(
        postCommand('projects.update', { projectId, shipsOn: '2025-01-01' }, ownerCookie),
      );

      expect(response.json()).toMatchObject({ code: 'INVARIANT_VIOLATED' });
    });
  });

  describe('WHEN a project is archived', () => {
    let projectId: string;

    beforeEach(async () => {
      const created = await createProject({ name: 'Kiln', code: 'KILN' });

      projectId = created.id;
      await server.inject(postCommand('projects.archive', { projectId }, ownerCookie));
    });

    it('THEN it leaves the launcher but is still there to be found', async () => {
      await expect(listProjects()).resolves.toMatchObject({ projects: [] });

      const archived = await listProjects('?scope=archived');
      expect(archived.projects).toHaveLength(1);
      expect(archived.projects[0]?.archivedAt).toEqual(expect.any(String));
    });

    it('THEN its settings screen still opens, which is where it is restored from', async () => {
      const response = await server.inject(getQuery('projects.detail', '?slug=kiln', ownerCookie));

      expect(response.statusCode).toBe(200);
    });

    it('THEN it cannot be edited until it is restored', async () => {
      const response = await server.inject(
        postCommand('projects.update', { projectId, phase: 'alpha' }, ownerCookie),
      );

      expect(response.json()).toMatchObject({ code: 'INVARIANT_VIOLATED' });
    });

    it('THEN archiving it again is accepted and changes nothing', async () => {
      const before = await testDatabase.database
        .selectFrom('project')
        .select('archivedAt')
        .executeTakeFirstOrThrow();

      const response = await server.inject(
        postCommand('projects.archive', { projectId }, ownerCookie),
      );

      const after = await testDatabase.database
        .selectFrom('project')
        .select('archivedAt')
        .executeTakeFirstOrThrow();

      expect(response.json()).toMatchObject({ ok: true });
      expect(after.archivedAt).toEqual(before.archivedAt);
    });

    it('THEN restoring it puts it back on the launcher', async () => {
      await server.inject(postCommand('projects.restore', { projectId }, ownerCookie));

      const { projects } = await listProjects();

      expect(projects).toHaveLength(1);
      expect(projects[0]?.archivedAt).toBeNull();
    });
  });

  describe('WHEN the caller is not the owner', () => {
    beforeEach(async () => {
      await createProject({ name: 'Drowned Reach', code: 'DRCH' });
      await createProject({ name: 'Kiln', code: 'KILN' });
    });

    it('THEN a member sees only the projects they were added to', async () => {
      const memberId = await seedTeammate('member', 'member@northwind.test');
      const kiln = await testDatabase.database
        .selectFrom('project')
        .select('id')
        .where('code', '=', 'KILN')
        .executeTakeFirstOrThrow();

      await testDatabase.database
        .insertInto('projectMember')
        .values({ projectId: kiln.id, userId: memberId, role: 'member' })
        .execute();

      const { projects } = await listProjects('', await signIn('member@northwind.test'));

      expect(projects.map((project) => project.code)).toEqual(['KILN']);
      expect(projects[0]?.role).toBe('member');
    });

    it('THEN a lead sees every project, at the authority they are using', async () => {
      await seedTeammate('lead', 'lead@northwind.test');

      const { projects } = await listProjects('', await signIn('lead@northwind.test'));

      expect(projects).toHaveLength(2);
      expect(projects.every((project) => project.role === 'lead')).toBe(true);
    });

    it('THEN a member cannot create a project', async () => {
      await seedTeammate('member', 'member@northwind.test');

      const response = await server.inject(
        postCommand(
          'projects.create',
          { name: 'Unapproved', code: 'UNAP' },
          await signIn('member@northwind.test'),
        ),
      );

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
    });

    it('THEN a lead can create and edit, but not archive', async () => {
      await seedTeammate('lead', 'lead@northwind.test');
      const leadCookie = await signIn('lead@northwind.test');
      const created = await createProject({ name: 'Lead Project', code: 'LEAD' }, leadCookie);

      const edited = await server.inject(
        postCommand('projects.update', { projectId: created.id, phase: 'beta' }, leadCookie),
      );
      const archived = await server.inject(
        postCommand('projects.archive', { projectId: created.id }, leadCookie),
      );

      expect(edited.json()).toMatchObject({ ok: true });
      expect(archived.json()).toMatchObject({ code: 'FORBIDDEN' });
    });

    it('THEN an outsourcer is refused, because their access is card by card', async () => {
      await seedTeammate('outsourcer', 'outsourcer@northwind.test');

      const response = await server.inject(
        getQuery('projects.list', '', await signIn('outsourcer@northwind.test')),
      );

      expect(response.statusCode).toBe(403);
    });
  });

  describe('WHEN nobody is signed in', () => {
    it('THEN the launcher refuses the request rather than leaking the slate', async () => {
      const response = await server.inject(getQuery('projects.list', ''));

      expect(response.statusCode).toBe(401);
    });

    it('THEN a project cannot be created', async () => {
      const response = await server.inject(
        postCommand('projects.create', { name: 'Anonymous', code: 'ANON' }),
      );

      expect(response.statusCode).toBe(401);
    });
  });

  describe('WHEN a project belongs to a different account', () => {
    let foreignProjectId: string;

    beforeEach(async () => {
      const account = await testDatabase.database
        .insertInto('account')
        .values({ name: 'Other Studio', slug: 'other-studio' })
        .returning('id')
        .executeTakeFirstOrThrow();

      const project = await testDatabase.database
        .insertInto('project')
        .values({ accountId: account.id, name: 'Secret', code: 'SCRT', slug: 'secret' })
        .returning('id')
        .executeTakeFirstOrThrow();

      foreignProjectId = project.id;
    });

    it('THEN it is not in the launcher', async () => {
      await expect(listProjects('?scope=all')).resolves.toMatchObject({ projects: [] });
    });

    it('THEN opening it reads as not existing, so nothing is confirmed by guessing', async () => {
      const response = await server.inject(
        getQuery('projects.detail', '?slug=secret', ownerCookie),
      );

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('THEN editing it is refused the same way', async () => {
      const response = await server.inject(
        postCommand('projects.update', { projectId: foreignProjectId, phase: 'beta' }, ownerCookie),
      );

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN the timeline is asked who is doing what', () => {
    let projectId: string;
    let listId: string;

    beforeEach(async () => {
      projectId = (await createProject({ name: 'Drowned Reach', code: 'DRCH' })).id;
      listId = await firstListOf(projectId);
    });

    async function timeline(search: string): Promise<ProjectTimelineView> {
      const response = await server.inject(getQuery('projects.timeline', search, ownerCookie));

      return response.json<{ data: ProjectTimelineView }>().data;
    }

    async function addCard(fields: Record<string, unknown>): Promise<string> {
      const response = await server.inject(
        postCommand(
          'board.createCard',
          { projectId, listId, title: 'Retopologise the watchtower', type: 'art', ...fields },
          ownerCookie,
        ),
      );

      return response.json<{ id: string }>().id;
    }

    it('THEN it answers with a fortnight of days, starting where it was asked to', async () => {
      const view = await timeline('?slug=drowned-reach&from=2026-08-24');

      expect(view.days).toHaveLength(TIMELINE_DAYS);
      expect(view.days[0]).toMatchObject({ date: '2026-08-24', weekday: 'Mon', dayOfMonth: 24 });
      expect(view.days[13]?.date).toBe('2026-09-06');
    });

    it('THEN weekends are marked rather than left out, because work lands on them', async () => {
      const view = await timeline('?slug=drowned-reach&from=2026-08-24');

      expect(view.days.filter((day) => day.isWeekend).map((day) => day.date)).toEqual([
        '2026-08-29',
        '2026-08-30',
        '2026-09-05',
        '2026-09-06',
      ]);
    });

    it('THEN everybody on the project has a row, including the ones with nothing on', async () => {
      // A chart drawn from only the busy half of a team cannot show who is free,
      // which is the question somebody came to it with.
      const view = await timeline('?slug=drowned-reach&from=2026-08-24');

      expect(view.groups.map((group) => group.name)).toEqual(['Jake Winters']);
      expect(view.groups[0]?.capacityHoursPerDay).toBe(8);
    });

    it('THEN a card runs backwards from its due date at the assignee rate', async () => {
      await addCard({ assigneeId: ownerId, dueOn: '2026-08-27', estimateMinutes: 24 * 60 });

      const view = await timeline('?slug=drowned-reach&from=2026-08-24');

      expect(view.groups[0]?.bars[0]).toMatchObject({ startIndex: 1, spanDays: 3 });
      expect(view.groups[0]?.hoursByDay.slice(0, 5)).toEqual([0, 8, 8, 8, 0]);
    });

    it('THEN work nobody owns is gathered under its own row with no capacity', async () => {
      await addCard({ dueOn: '2026-08-26', estimateMinutes: 4 * 60 });

      const view = await timeline('?slug=drowned-reach&from=2026-08-24');
      const unassigned = view.groups.find((group) => group.id === 'unassigned');

      // An hour here is an hour nobody has agreed to do, so it is measured
      // against nothing rather than against a day somebody has.
      expect(unassigned).toMatchObject({ name: 'Nobody assigned', capacityHoursPerDay: 0 });
      expect(unassigned?.bars).toHaveLength(1);
    });

    it('THEN a closed card takes none of the days ahead', async () => {
      const cardId = await addCard({
        assigneeId: ownerId,
        dueOn: '2026-08-26',
        estimateMinutes: 8 * 60,
      });

      await closeCard(projectId, cardId);

      expect((await timeline('?slug=drowned-reach&from=2026-08-24')).groups[0]?.bars).toEqual([]);
    });

    it('THEN a card with no date at all is not on the chart', async () => {
      await addCard({ assigneeId: ownerId, estimateMinutes: 8 * 60 });

      expect((await timeline('?slug=drowned-reach&from=2026-08-24')).groups[0]?.bars).toEqual([]);
    });

    it('THEN the day load is what everybody put on that day together', async () => {
      await addCard({ assigneeId: ownerId, dueOn: '2026-08-25', estimateMinutes: 8 * 60 });
      await addCard({ dueOn: '2026-08-25', estimateMinutes: 2 * 60 });

      const view = await timeline('?slug=drowned-reach&from=2026-08-24');

      expect(view.loadByDay[1]).toBe(10);
      expect(view.teamCapacityHoursPerDay).toBe(8);
    });

    it('THEN a project this caller cannot reach is refused', async () => {
      const response = await server.inject(
        getQuery('projects.timeline', '?slug=nothing-here', ownerCookie),
      );

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN the timeline is grouped by milestone', () => {
    let projectId: string;
    let listId: string;
    let sliceId: string;

    beforeEach(async () => {
      projectId = (await createProject({ name: 'Drowned Reach', code: 'DRCH' })).id;
      listId = await firstListOf(projectId);
      sliceId = (
        await server.inject(
          postCommand(
            'milestones.create',
            {
              projectId,
              name: 'Vertical slice',
              startsOn: '2026-08-24',
              shipsOn: '2026-08-28',
            },
            ownerCookie,
          ),
        )
      ).json<{ id: string }>().id;
    });

    async function grouped(search: string): Promise<ProjectTimelineView> {
      const response = await server.inject(getQuery('projects.timeline', search, ownerCookie));

      return response.json<{ data: ProjectTimelineView }>().data;
    }

    async function addCard(fields: Record<string, unknown>): Promise<string> {
      const response = await server.inject(
        postCommand(
          'board.createCard',
          { projectId, listId, title: 'Retopologise the watchtower', type: 'art', ...fields },
          ownerCookie,
        ),
      );

      return response.json<{ id: string }>().id;
    }

    it('THEN a row is a milestone rather than a person', async () => {
      await addCard({ milestoneId: sliceId, dueOn: '2026-08-26', estimateMinutes: 8 * 60 });

      const view = await grouped('?slug=drowned-reach&from=2026-08-24&groupBy=milestone');

      expect(view.groupBy).toBe('milestone');
      expect(view.groups.map((group) => group.name)).toEqual(['Vertical slice']);
    });

    it('THEN it is measured against the whole team day, not one person', async () => {
      await addCard({ milestoneId: sliceId, dueOn: '2026-08-26', estimateMinutes: 8 * 60 });

      // A milestone is something the studio does together, so the question is
      // whether everything promised for the date fits in the days before it.
      expect(
        (await grouped('?slug=drowned-reach&from=2026-08-24&groupBy=milestone')).groups[0]
          ?.capacityHoursPerDay,
      ).toBe(8);
    });

    it('THEN work promised for nothing is gathered under its own row', async () => {
      await addCard({ milestoneId: sliceId, dueOn: '2026-08-26', estimateMinutes: 8 * 60 });
      await addCard({ dueOn: '2026-08-27', estimateMinutes: 4 * 60 });

      const view = await grouped('?slug=drowned-reach&from=2026-08-24&groupBy=milestone');

      expect(view.groups.map((group) => group.name)).toEqual(['Vertical slice', 'Not promised']);
    });

    it('THEN a milestone the fortnight does not touch is not a row', async () => {
      await server.inject(
        postCommand(
          'milestones.create',
          { projectId, name: 'Cert', startsOn: '2027-01-04', shipsOn: '2027-02-01' },
          ownerCookie,
        ),
      );

      // Fourteen empty columns pushing the ones that matter off the screen.
      const view = await grouped('?slug=drowned-reach&from=2026-08-24&groupBy=milestone');

      expect(view.groups.map((group) => group.name)).toEqual(['Vertical slice']);
    });

    it('THEN the day a milestone ships is marked, whichever way the rows are cut', async () => {
      const byPerson = await grouped('?slug=drowned-reach&from=2026-08-24');
      const byMilestone = await grouped('?slug=drowned-reach&from=2026-08-24&groupBy=milestone');

      // A deadline is a property of the date, not of a grouping.
      for (const view of [byPerson, byMilestone]) {
        expect(view.days.map((day) => day.milestoneName)).toEqual([
          null,
          null,
          null,
          null,
          'Vertical slice',
          ...Array.from({ length: 9 }, () => null),
        ]);
      }
    });

    it('THEN grouping by person is still what it answers with by default', async () => {
      expect((await grouped('?slug=drowned-reach&from=2026-08-24')).groupBy).toBe('person');
    });

    it('THEN a grouping it does not have is refused', async () => {
      const response = await server.inject(
        getQuery('projects.timeline', '?slug=drowned-reach&groupBy=by-vibes', ownerCookie),
      );

      expect(response.statusCode).toBe(422);
    });
  });

  describe('WHEN somebody is on the project through a team', () => {
    let projectId: string;
    let listId: string;
    let linhId: string;
    let teamId: string;

    beforeEach(async () => {
      projectId = (await createProject({ name: 'Drowned Reach', code: 'DRCH' })).id;
      listId = await firstListOf(projectId);
      linhId = await seedTeammate('member', 'linh@northwind.test', 'Linh Tran');

      teamId = (
        await server.inject(postCommand('teams.create', { name: 'Environment art' }, ownerCookie))
      ).json<{ id: string }>().id;

      await server.inject(postCommand('teams.addMember', { teamId, userId: linhId }, ownerCookie));
      await server.inject(postCommand('projects.addTeam', { projectId, teamId }, ownerCookie));
    });

    async function timeline(): Promise<ProjectTimelineView> {
      const response = await server.inject(
        getQuery('projects.timeline', '?slug=drowned-reach&from=2026-08-24', ownerCookie),
      );

      return response.json<{ data: ProjectTimelineView }>().data;
    }

    async function addCard(fields: Record<string, unknown>): Promise<void> {
      await server.inject(
        postCommand(
          'board.createCard',
          { projectId, listId, title: 'Retopologise the watchtower', type: 'art', ...fields },
          ownerCookie,
        ),
      );
    }

    it('THEN they have a row, the same as somebody put on the project by name', async () => {
      expect((await timeline()).groups.map((group) => group.name)).toEqual([
        'Jake Winters',
        'Linh Tran',
      ]);
    });

    it('THEN their work is drawn against them rather than as nobody’s', async () => {
      await addCard({ assigneeId: linhId, dueOn: '2026-08-26', estimateMinutes: 8 * 60 });

      const view = await timeline();

      expect(view.groups.find((group) => group.name === 'Linh Tran')?.bars).toHaveLength(1);
      // The symptom this was found by: work with an owner reading as unowned.
      expect(view.groups.find((group) => group.id === 'unassigned')).toBeUndefined();
    });

    it('THEN they are measured against a whole day, like everybody else', async () => {
      // Not a default standing in for a number somebody chose:
      // `0042-everybody-has-a-whole-day` put every direct member on eight and
      // took away the screen that could have said otherwise.
      expect(
        (await timeline()).groups.find((group) => group.name === 'Linh Tran')?.capacityHoursPerDay,
      ).toBe(8);
    });

    it('THEN being on it both ways is one row rather than two', async () => {
      await server.inject(
        postCommand('projects.addMember', { projectId, userId: linhId }, ownerCookie),
      );

      expect((await timeline()).groups.filter((group) => group.name === 'Linh Tran')).toHaveLength(
        1,
      );
    });

    it('THEN taking the team off the project takes them off the chart with it', async () => {
      // The grant is standing rather than a bulk add, so it has to come away
      // again as cleanly as it arrived.
      await server.inject(postCommand('projects.removeTeam', { projectId, teamId }, ownerCookie));

      expect((await timeline()).groups.map((group) => group.name)).toEqual(['Jake Winters']);
    });

    it('THEN somebody in a team that is on no project of theirs is not a row', async () => {
      const otherTeam = (
        await server.inject(postCommand('teams.create', { name: 'Audio' }, ownerCookie))
      ).json<{ id: string }>().id;
      const leoId = await seedTeammate('member', 'leo@northwind.test', 'Leo Marsh');

      await server.inject(
        postCommand('teams.addMember', { teamId: otherTeam, userId: leoId }, ownerCookie),
      );

      expect((await timeline()).groups.map((group) => group.name)).not.toContain('Leo Marsh');
    });
  });

  describe('WHEN somebody holding work has come off the project', () => {
    let projectId: string;
    let listId: string;
    let linhId: string;

    beforeEach(async () => {
      projectId = (await createProject({ name: 'Drowned Reach', code: 'DRCH' })).id;
      listId = await firstListOf(projectId);
      linhId = await seedTeammate('member', 'linh@northwind.test', 'Linh Tran');

      await server.inject(
        postCommand('projects.addMember', { projectId, userId: linhId }, ownerCookie),
      );
      await server.inject(
        postCommand(
          'board.createCard',
          {
            projectId,
            listId,
            title: 'Retopologise the watchtower',
            type: 'art',
            assigneeId: linhId,
            dueOn: '2026-08-26',
            estimateMinutes: 8 * 60,
          },
          ownerCookie,
        ),
      );

      // Nothing unassigns their cards, on purpose: who was doing it is the fact
      // somebody needs in order to hand it on.
      await server.inject(
        postCommand('projects.removeMember', { projectId, userId: linhId }, ownerCookie),
      );
    });

    async function timeline(search = ''): Promise<ProjectTimelineView> {
      const response = await server.inject(
        getQuery('projects.timeline', `?slug=drowned-reach&from=2026-08-24${search}`, ownerCookie),
      );

      return response.json<{ data: ProjectTimelineView }>().data;
    }

    it('THEN their work is still drawn, against their name', async () => {
      const view = await timeline();
      const linh = view.groups.find((group) => group.name === 'Linh Tran');

      // It used to be held by no row at all, so it left the chart entirely.
      expect(linh?.bars).toHaveLength(1);
    });

    it('THEN the row says why it has no day behind it', async () => {
      const view = await timeline();
      const linh = view.groups.find((group) => group.name === 'Linh Tran');

      // No capacity, because they have not promised this project a day — and
      // told apart from `Nobody assigned`, which has none for another reason.
      expect(linh).toMatchObject({ capacityHoursPerDay: 0, offTheProject: true });
    });

    it('THEN the day load counts the hours, because the fortnight still owes them', async () => {
      // The footer is the sum of the rows, so work held by nobody's row was
      // work the fortnight did not know about.
      expect((await timeline()).loadByDay[2]).toBe(8);
    });

    it('THEN it is not mistaken for work nobody was ever given', async () => {
      const view = await timeline();

      expect(view.groups.find((group) => group.id === 'unassigned')).toBeUndefined();
    });

    it('THEN somebody still on the project is not marked as having left', async () => {
      const view = await timeline();

      expect(view.groups.find((group) => group.name === 'Jake Winters')).toMatchObject({
        offTheProject: false,
      });
    });

    it('THEN by team gathers the same work rather than dropping it', async () => {
      const view = await timeline('&groupBy=team');
      const loose = view.groups.find((group) => group.id === 'no-team');

      expect(loose?.bars).toHaveLength(1);
    });
  });

  describe('WHEN the timeline is grouped by team', () => {
    let projectId: string;
    let listId: string;
    let danielId: string;
    let linhId: string;
    let audioId: string;
    let environmentId: string;

    beforeEach(async () => {
      projectId = (await createProject({ name: 'Drowned Reach', code: 'DRCH' })).id;
      listId = await firstListOf(projectId);
      danielId = await seedTeammate('member', 'daniel@northwind.test', 'Daniel Okafor');
      linhId = await seedTeammate('member', 'linh@northwind.test', 'Linh Tran');
      audioId = await makeTeam('Audio');
      environmentId = await makeTeam('Environment art');

      await joinTeam(audioId, danielId);
      await joinTeam(environmentId, linhId);
      await putTeamOnProject(audioId);
      await putTeamOnProject(environmentId);
    });

    async function makeTeam(name: string): Promise<string> {
      const response = await server.inject(postCommand('teams.create', { name }, ownerCookie));

      return response.json<{ id: string }>().id;
    }

    async function joinTeam(teamId: string, userId: string): Promise<void> {
      await server.inject(postCommand('teams.addMember', { teamId, userId }, ownerCookie));
    }

    async function putTeamOnProject(teamId: string): Promise<void> {
      await server.inject(postCommand('projects.addTeam', { projectId, teamId }, ownerCookie));
    }

    async function grouped(): Promise<ProjectTimelineView> {
      const response = await server.inject(
        getQuery(
          'projects.timeline',
          '?slug=drowned-reach&from=2026-08-24&groupBy=team',
          ownerCookie,
        ),
      );

      return response.json<{ data: ProjectTimelineView }>().data;
    }

    async function addCard(fields: Record<string, unknown>): Promise<void> {
      await server.inject(
        postCommand(
          'board.createCard',
          { projectId, listId, title: 'Retopologise the watchtower', type: 'art', ...fields },
          ownerCookie,
        ),
      );
    }

    it('THEN a row is a team rather than a person', async () => {
      const view = await grouped();

      expect(view.groupBy).toBe('team');
      // The owner is on the project by name and in neither team, so the row
      // that gathers those is here from the start.
      expect(view.groups.map((group) => group.name)).toEqual([
        'Audio',
        'Environment art',
        'No team',
      ]);
    });

    it('THEN a team is measured against its own day, not the whole studio’s', async () => {
      const view = await grouped();

      // Four people in environment art cannot spend the animators' afternoons,
      // and a row that said they could would call every team comfortable.
      expect(view.groups.find((group) => group.name === 'Audio')?.capacityHoursPerDay).toBe(8);
      expect(view.teamCapacityHoursPerDay).toBe(24);
    });

    it('THEN work lands on the row of the team its assignee is in', async () => {
      await addCard({ assigneeId: danielId, dueOn: '2026-08-26', estimateMinutes: 8 * 60 });

      const view = await grouped();

      expect(view.groups.find((group) => group.name === 'Audio')?.bars).toHaveLength(1);
      expect(view.groups.find((group) => group.name === 'Environment art')?.bars).toEqual([]);
    });

    it('THEN somebody in two of the project’s teams is counted once, under the first by name', async () => {
      await joinTeam(environmentId, danielId);
      await addCard({ assigneeId: danielId, dueOn: '2026-08-26', estimateMinutes: 8 * 60 });

      const view = await grouped();

      expect(view.groups.find((group) => group.name === 'Audio')?.bars).toHaveLength(1);
      expect(view.groups.find((group) => group.name === 'Environment art')?.bars).toEqual([]);
    });

    it('THEN the rows still add up to the studio, however many teams somebody is in', async () => {
      await joinTeam(environmentId, danielId);

      const view = await grouped();
      const acrossRows = view.groups.reduce((total, group) => total + group.capacityHoursPerDay, 0);

      // The rows are a partition. Drawing Daniel on both would read better on
      // one row and lie in the footer, which sums them.
      expect(acrossRows).toBe(view.teamCapacityHoursPerDay);
    });

    it('THEN an hour is counted once in the day load, not once per team', async () => {
      await joinTeam(environmentId, danielId);
      await addCard({ assigneeId: danielId, dueOn: '2026-08-25', estimateMinutes: 8 * 60 });

      expect((await grouped()).loadByDay[1]).toBe(8);
    });

    it('THEN people on the project by name are gathered under a row of their own', async () => {
      await addCard({ assigneeId: ownerId, dueOn: '2026-08-26', estimateMinutes: 4 * 60 });

      const view = await grouped();
      const loose = view.groups.find((group) => group.id === 'no-team');

      // They are on the project and doing the work, so they need a row; they
      // are not any team's load, so it is not one of the team rows.
      expect(loose).toMatchObject({ name: 'No team', capacityHoursPerDay: 8 });
      expect(loose?.bars).toHaveLength(1);
    });

    it('THEN work nobody owns is gathered the way it is by person', async () => {
      await addCard({ dueOn: '2026-08-26', estimateMinutes: 4 * 60 });

      const view = await grouped();

      expect(view.groups.find((group) => group.id === 'unassigned')).toMatchObject({
        name: 'Nobody assigned',
        capacityHoursPerDay: 0,
      });
    });

    it('THEN a team with nobody in it is still a row', async () => {
      await putTeamOnProject(await makeTeam('Zebra'));

      const view = await grouped();

      // An empty discipline on a project is a fact worth drawing, and it says
      // so with no capacity rather than by being absent.
      expect(view.groups.find((group) => group.name === 'Zebra')).toMatchObject({
        capacityHoursPerDay: 0,
        bars: [],
      });
    });

    it('THEN a project with no teams and nobody on it draws nothing at all', async () => {
      const bare = (await createProject({ name: 'Bare', code: 'BARE' })).id;

      await server.inject(
        postCommand('projects.removeMember', { projectId: bare, userId: ownerId }, ownerCookie),
      );

      const response = await server.inject(
        getQuery('projects.timeline', '?slug=bare&from=2026-08-24&groupBy=team', ownerCookie),
      );

      expect(response.json<{ data: ProjectTimelineView }>().data.groups).toEqual([]);
    });
  });

  describe('WHEN the release plan is read', () => {
    let projectId: string;
    let listId: string;

    beforeEach(async () => {
      projectId = (await createProject({ name: 'Drowned Reach', code: 'DRCH' })).id;
      listId = await firstListOf(projectId);
    });

    async function plan(): Promise<MilestonePlanView> {
      const response = await server.inject(
        getQuery('milestones.plan', '?slug=drowned-reach', ownerCookie),
      );

      return response.json<{ data: MilestonePlanView }>().data;
    }

    async function addMilestone(fields: Record<string, unknown>): Promise<string> {
      const response = await server.inject(
        postCommand(
          'milestones.create',
          {
            projectId,
            name: 'Vertical slice',
            startsOn: '2026-08-24',
            shipsOn: '2026-09-06',
            ...fields,
          },
          ownerCookie,
        ),
      );

      return response.json<{ id: string }>().id;
    }

    async function addCard(fields: Record<string, unknown>): Promise<string> {
      const response = await server.inject(
        postCommand(
          'board.createCard',
          { projectId, listId, title: 'Retopologise the watchtower', type: 'art', ...fields },
          ownerCookie,
        ),
      );

      return response.json<{ id: string }>().id;
    }

    it('THEN a project with no dates answers empty rather than refusing', async () => {
      const view = await plan();

      expect(view.milestones).toEqual([]);
      expect(view.today).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    });

    it('THEN milestones come back in the order they land', async () => {
      await addMilestone({ name: 'Cert', startsOn: '2027-01-04', shipsOn: '2027-02-01' });
      await addMilestone({ name: 'Alpha', startsOn: '2026-11-02', shipsOn: '2026-11-30' });
      await addMilestone({ name: 'Slice', startsOn: '2026-08-24', shipsOn: '2026-09-06' });

      // A plan is read to see what comes after the thing that is late.
      expect((await plan()).milestones.map((milestone) => milestone.name)).toEqual([
        'Slice',
        'Alpha',
        'Cert',
      ]);
    });

    it('THEN a milestone with nothing promised for it still counts to zero', async () => {
      await addMilestone({});

      expect((await plan()).milestones[0]).toMatchObject({
        openCount: 0,
        closedCount: 0,
        pointsTotal: 0,
        pointsClosed: 0,
        blockedCount: 0,
      });
    });

    it('THEN it counts the cards promised for it and nothing else', async () => {
      const milestoneId = await addMilestone({});

      await addCard({ milestoneId, points: 5 });
      await addCard({ milestoneId, points: 3 });
      // Not promised for anything, so it is somebody else's problem.
      await addCard({ points: 8 });

      expect((await plan()).milestones[0]).toMatchObject({
        openCount: 2,
        pointsTotal: 8,
      });
    });

    it('THEN closing a card moves the burndown without anything being stored', async () => {
      const milestoneId = await addMilestone({});
      const cardId = await addCard({ milestoneId, points: 5 });
      await addCard({ milestoneId, points: 3 });

      await closeCard(projectId, cardId);

      expect((await plan()).milestones[0]).toMatchObject({
        openCount: 1,
        closedCount: 1,
        pointsClosed: 5,
        pointsTotal: 8,
      });
    });

    it('THEN a blocked card is counted only while it is open', async () => {
      const milestoneId = await addMilestone({});
      const cardId = await addCard({ milestoneId, points: 5 });

      await server.inject(postCommand('board.updateCard', { cardId, blocked: true }, ownerCookie));
      expect((await plan()).milestones[0]?.blockedCount).toBe(1);

      await closeCard(projectId, cardId);

      // A finished card that was stuck is history, not a thing to act on.
      expect((await plan()).milestones[0]?.blockedCount).toBe(0);
    });

    it('THEN where it stands is worked out from its dates rather than stored', async () => {
      await addMilestone({ name: 'Long past', startsOn: '2020-01-01', shipsOn: '2020-02-01' });
      await addMilestone({ name: 'Far off', startsOn: '2099-01-01', shipsOn: '2099-02-01' });

      const view = await plan();

      // A state somebody has to remember to change is one that says "Active"
      // about a milestone that ended in March.
      expect(view.milestones.map((milestone) => milestone.state)).toEqual(['shipped', 'planned']);
      expect(view.milestones[0]?.daysLeft).toBeLessThan(0);
    });

    it('THEN a milestone that ends before it starts is refused', async () => {
      const response = await server.inject(
        postCommand(
          'milestones.create',
          {
            projectId,
            name: 'Backwards',
            startsOn: '2026-09-06',
            shipsOn: '2026-08-24',
          },
          ownerCookie,
        ),
      );

      expect(response.statusCode).toBe(409);
    });

    it('THEN moving only the end past the start is refused too', async () => {
      const milestoneId = await addMilestone({});

      // Checked against the merged result, not against what arrived.
      const response = await server.inject(
        postCommand('milestones.update', { milestoneId, shipsOn: '2026-08-01' }, ownerCookie),
      );

      expect(response.statusCode).toBe(409);
    });

    it('THEN dropping one unpromises its cards rather than deleting them', async () => {
      const milestoneId = await addMilestone({});
      const cardId = await addCard({ milestoneId, points: 5 });

      await server.inject(postCommand('milestones.delete', { milestoneId }, ownerCookie));

      const card = await server.inject(
        getQuery('board.cardDetail', `?cardId=${cardId}`, ownerCookie),
      );

      // A date being dropped does not mean the work was.
      expect(card.statusCode).toBe(200);
      expect(card.json<{ data: { milestone: unknown } }>().data.milestone).toBeNull();
    });

    it('THEN a project this caller cannot reach is refused', async () => {
      const response = await server.inject(
        getQuery('milestones.plan', '?slug=nothing-here', ownerCookie),
      );

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN a project that does not exist is asked for', () => {
    it('THEN the detail query answers not found', async () => {
      const response = await server.inject(
        getQuery('projects.detail', '?slug=nothing-here', ownerCookie),
      );

      expect(response.statusCode).toBe(404);
    });
  });
});
