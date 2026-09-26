import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import type { DeletedThingsView } from '@lpm/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createServer } from '../../server/create-server.js';
import { readEnvironment } from '../../server/environment.js';
import { createStubObjectStore } from '../../storage/index.js';
import { createStubRedis } from '../../testing/index.js';
import { hashPassword } from '../identity/password-hasher.js';
import { purgeExpired, RETENTION_DAYS } from './recycle-bin.js';

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
  return `018f9999-0000-7000-8000-${String(commandCounter).padStart(12, '0')}`;
}

function readSessionCookie(cookies: readonly { name: string; value: string }[]): string {
  const cookie = cookies.find((candidate) => candidate.name === 'lpm_session');

  if (cookie === undefined) {
    throw new Error('Expected a session cookie to have been set.');
  }

  return cookie.value;
}

describe('GIVEN an install where things get deleted', () => {
  const redis = createStubRedis();

  let testDatabase: TestDatabase;
  let server: FastifyInstance;
  let passwordHash: string;
  let ownerCookie: string;
  let projectId: string;

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
    projectId = (await command('projects.create', { name: 'Saltmarsh', code: 'SLTM' })).json<{
      id: string;
    }>().id;
  });

  async function signIn(email: string): Promise<string> {
    return readSessionCookie(
      (
        await server.inject({
          method: 'POST',
          url: '/api/c/identity.signIn',
          payload: { commandId: nextCommandId(), email, password: PASSWORD },
        })
      ).cookies,
    );
  }

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

  async function bin(cookie = ownerCookie): Promise<DeletedThingsView> {
    const response = await server.inject({
      method: 'GET',
      url: '/api/q/recovery.deletedThings',
      cookies: { lpm_session: cookie },
    });

    return response.json<{ data: DeletedThingsView }>().data;
  }

  /** Makes a team with a name, and hands back its id. */
  async function makeTeam(name: string): Promise<string> {
    return (await command('teams.create', { name })).json<{ id: string }>().id;
  }

  /** A card on the first list the project was made with. */
  async function makeCard(title: string): Promise<string> {
    const list = await testDatabase.database
      .selectFrom('list')
      .innerJoin('board', 'board.id', 'list.boardId')
      .select('list.id')
      .where('board.projectId', '=', projectId)
      .orderBy('list.position', 'asc')
      .executeTakeFirstOrThrow();

    return (
      await command('board.createCard', { projectId, listId: list.id, title, type: 'task' })
    ).json<{ id: string }>().id;
  }

  /** How many links exist at all, which is what a restore is counted by. */
  async function linkCount(): Promise<number> {
    const links = await testDatabase.database.selectFrom('cardLink').select('id').execute();

    return links.length;
  }

  /** The cards still on the board, by title. */
  async function cardTitles(): Promise<string[]> {
    const cards = await testDatabase.database
      .selectFrom('card')
      .select('title')
      .orderBy('cardKey')
      .execute();

    return cards.map((card) => card.title);
  }

  describe('WHEN a team is deleted', () => {
    it('THEN it is gone from the teams, and waiting in the bin', async () => {
      const teamId = await makeTeam('Audio');

      await command('teams.delete', { teamId });

      const teams = await testDatabase.database.selectFrom('team').selectAll().execute();

      expect(teams).toHaveLength(0);

      const { things } = await bin();

      expect(things).toHaveLength(1);
      expect(things[0]?.what).toBe('Team');
      expect(things[0]?.name).toBe('Audio');
      expect(things[0]?.deletedBy).toBe('Jake Winters');
    });

    it('THEN putting it back gives it the same id, so nothing pointing at it is orphaned', async () => {
      const teamId = await makeTeam('Audio');

      await command('teams.delete', { teamId });

      const { things } = await bin();

      await command('recovery.restore', { deletedThingId: things[0]?.id });

      const teams = await testDatabase.database.selectFrom('team').selectAll().execute();

      expect(teams).toHaveLength(1);
      expect(teams[0]?.id).toBe(teamId);
      expect(teams[0]?.name).toBe('Audio');
    });

    it('THEN the people who were in it are in it again', async () => {
      const teamId = await makeTeam('Audio');
      const owner = await testDatabase.database
        .selectFrom('appUser')
        .select('id')
        .executeTakeFirstOrThrow();

      await command('teams.addMember', { teamId, userId: owner.id });
      await command('teams.delete', { teamId });

      const { things } = await bin();

      await command('recovery.restore', { deletedThingId: things[0]?.id });

      const members = await testDatabase.database.selectFrom('teamMember').selectAll().execute();

      expect(members).toHaveLength(1);
      expect(members[0]?.userId).toBe(owner.id);
    });

    it('THEN the bin row goes with the restore, so it cannot be put back twice', async () => {
      const teamId = await makeTeam('Audio');

      await command('teams.delete', { teamId });

      const { things } = await bin();
      const deletedThingId = things[0]?.id;

      await command('recovery.restore', { deletedThingId });

      expect(await bin()).toEqual({ things: [], retentionDays: RETENTION_DAYS });

      const second = await command('recovery.restore', { deletedThingId });

      expect(second.statusCode).toBe(404);
    });

    it('THEN it says how many people were in it, so the bin can be read without opening anything', async () => {
      const teamId = await makeTeam('Audio');
      const owner = await testDatabase.database
        .selectFrom('appUser')
        .select('id')
        .executeTakeFirstOrThrow();

      await command('teams.addMember', { teamId, userId: owner.id });
      await command('teams.delete', { teamId });

      expect((await bin()).things[0]?.about).toBe('1 person');
    });
  });

  describe('WHEN a permission group is deleted', () => {
    it('THEN its rules come back with it', async () => {
      const groupId = (await command('permissions.createGroup', { name: 'Outsourcer' })).json<{
        id: string;
      }>().id;

      await command('permissions.setRule', {
        groupId,
        subject: 'card.move',
        effect: 'deny',
      });

      await command('permissions.deleteGroup', { groupId });

      const { things } = await bin();

      expect(things[0]?.about).toBe('1 rule');

      await command('recovery.restore', { deletedThingId: things[0]?.id });

      const rules = await testDatabase.database.selectFrom('permissionRule').selectAll().execute();

      expect(rules).toHaveLength(1);
      expect(rules[0]?.action).toBe('card.move');
      expect(rules[0]?.effect).toBe('deny');
    });

    it('THEN a link to a team that has since gone is left out rather than failing the whole restore', async () => {
      const groupId = (await command('permissions.createGroup', { name: 'Outsourcer' })).json<{
        id: string;
      }>().id;

      const teamId = await makeTeam('Audio');

      await command('permissions.setTeamGroup', { teamId, groupId, held: true });
      await command('permissions.deleteGroup', { groupId });

      // The team goes too, and is purged, so its half of the link is really
      // gone by the time the group is put back.
      await command('teams.delete', { teamId });

      const binned = (await bin()).things;
      const team = binned.find((thing) => thing.what === 'Team');
      const group = binned.find((thing) => thing.what === 'Permission group');

      await command('recovery.purge', { deletedThingId: team?.id });

      const restored = await command('recovery.restore', { deletedThingId: group?.id });

      expect(restored.statusCode).toBe(200);

      const groups = await testDatabase.database
        .selectFrom('permissionGroup')
        .selectAll()
        .execute();
      const links = await testDatabase.database
        .selectFrom('teamPermissionGroup')
        .selectAll()
        .execute();

      expect(groups).toHaveLength(1);
      expect(links).toHaveLength(0);
    });
  });

  describe('WHEN a milestone is deleted', () => {
    it('THEN the cards it held are promised to it again', async () => {
      const milestoneId = (
        await command('milestones.create', {
          projectId,
          name: 'Vertical slice',
          startsOn: '2026-01-05',
          shipsOn: '2026-02-27',
        })
      ).json<{ id: string }>().id;

      const cardId = await makeCard('Water shader');

      await command('board.updateCard', { cardId, milestoneId });
      await command('milestones.delete', { milestoneId });

      const loosened = await testDatabase.database
        .selectFrom('card')
        .select('milestoneId')
        .where('id', '=', cardId)
        .executeTakeFirstOrThrow();

      expect(loosened.milestoneId).toBeNull();

      const { things } = await bin();

      await command('recovery.restore', { deletedThingId: things[0]?.id });

      const repaired = await testDatabase.database
        .selectFrom('card')
        .select('milestoneId')
        .where('id', '=', cardId)
        .executeTakeFirstOrThrow();

      expect(repaired.milestoneId).toBe(milestoneId);
    });

    it('THEN a card somebody moved to another milestone in the meantime is left where they put it', async () => {
      const first = (
        await command('milestones.create', {
          projectId,
          name: 'Vertical slice',
          startsOn: '2026-01-05',
          shipsOn: '2026-02-27',
        })
      ).json<{ id: string }>().id;

      const cardId = await makeCard('Water shader');

      await command('board.updateCard', { cardId, milestoneId: first });
      await command('milestones.delete', { milestoneId: first });

      // A new milestone, and the card is put on it. That is a decision, and
      // undoing the delete is not licence to undo it.
      const second = (
        await command('milestones.create', {
          projectId,
          name: 'Alpha',
          startsOn: '2026-03-02',
          shipsOn: '2026-05-29',
        })
      ).json<{ id: string }>().id;

      await command('board.updateCard', { cardId, milestoneId: second });

      const { things } = await bin();

      await command('recovery.restore', { deletedThingId: things[0]?.id });

      const card = await testDatabase.database
        .selectFrom('card')
        .select('milestoneId')
        .where('id', '=', cardId)
        .executeTakeFirstOrThrow();

      expect(card.milestoneId).toBe(second);
    });
  });

  describe('WHEN a document is deleted', () => {
    it('THEN every word of it comes back', async () => {
      const docId = (await command('docs.createDoc', { projectId, title: 'Combat design' })).json<{
        id: string;
      }>().id;

      await command('docs.updateDoc', { docId, body: '# Parrying\n\nIt has weight.' });
      await command('docs.deleteDoc', { docId });

      const { things } = await bin();

      expect(things[0]?.what).toBe('Document');
      expect(things[0]?.name).toBe('Combat design');

      await command('recovery.restore', { deletedThingId: things[0]?.id });

      const document = await testDatabase.database
        .selectFrom('projectDoc')
        .select(['id', 'title', 'body'])
        .executeTakeFirstOrThrow();

      expect(document.id).toBe(docId);
      expect(document.title).toBe('Combat design');
      expect(document.body).toBe('# Parrying\n\nIt has weight.');
    });
  });

  describe('WHEN a card is deleted', () => {
    it('THEN it waits in the bin under the key people call it by', async () => {
      const cardId = await makeCard('Water shader');

      await command('board.deleteCard', { cardId });

      expect((await bin()).things[0]).toMatchObject({
        what: 'Card',
        name: 'Water shader',
        about: 'SLTM-TASK-1',
      });
    });

    it('THEN putting it back brings the conversation with it', async () => {
      const cardId = await makeCard('Water shader');

      await command('board.addSubtask', { cardId, title: 'Foam pass' });
      await command('board.comment', { cardId, body: 'The edges are wrong.' });
      await command('board.deleteCard', { cardId });

      const { things } = await bin();
      await command('recovery.restore', { deletedThingId: things[0]?.id });

      const subtasks = await testDatabase.database
        .selectFrom('subtask')
        .select('title')
        .where('cardId', '=', cardId)
        .execute();
      const comments = await testDatabase.database
        .selectFrom('comment')
        .select('body')
        .where('cardId', '=', cardId)
        .execute();

      expect(subtasks).toEqual([{ title: 'Foam pass' }]);
      expect(comments).toEqual([{ body: 'The edges are wrong.' }]);
    });

    it('THEN both halves of a link come back, though only one of them named it', async () => {
      const blocked = await makeCard('Harbour lighting');
      const blocker = await makeCard('Water shader');

      // Written as a pair, so the card on each end knows about the other. Only
      // one of the two rows has the deleted card in `from_card_id`; the other
      // reaches it the opposite way, and both have to be gathered.
      await command('board.linkCard', {
        cardId: blocked,
        toCardKey: 'SLTM-TASK-2',
        kind: 'blocked_by',
      });
      await command('board.deleteCard', { cardId: blocker });

      expect(await linkCount()).toBe(0);

      const { things } = await bin();
      await command('recovery.restore', { deletedThingId: things[0]?.id });

      expect(await linkCount()).toBe(2);
    });

    it('THEN a link whose other end has since gone is left out rather than failing the restore', async () => {
      const blocked = await makeCard('Harbour lighting');
      const blocker = await makeCard('Water shader');

      await command('board.linkCard', {
        cardId: blocked,
        toCardKey: 'SLTM-TASK-2',
        kind: 'blocked_by',
      });
      await command('board.deleteCard', { cardId: blocker });
      await command('board.deleteCard', { cardId: blocked });

      const forBlocker = (await bin()).things.find((thing) => thing.name === 'Water shader');
      const response = await command('recovery.restore', { deletedThingId: forBlocker?.id });

      // The card comes back; the links do not, because there is nothing left
      // for them to be about.
      expect(response.statusCode).toBe(200);
      expect(await linkCount()).toBe(0);
      expect(await cardTitles()).toEqual(['Water shader']);
    });

    it('THEN a card whose milestone was dropped in the meantime comes back unpromised', async () => {
      const milestoneId = (
        await command('milestones.create', {
          projectId,
          name: 'Vertical slice',
          startsOn: '2026-01-05',
          shipsOn: '2026-02-27',
        })
      ).json<{ id: string }>().id;

      const cardId = await makeCard('Water shader');

      await command('board.updateCard', { cardId, milestoneId });
      await command('board.deleteCard', { cardId });
      await command('milestones.delete', { milestoneId });

      const forCard = (await bin()).things.find((thing) => thing.name === 'Water shader');
      const response = await command('recovery.restore', { deletedThingId: forCard?.id });

      const back = await testDatabase.database
        .selectFrom('card')
        .select('milestoneId')
        .where('id', '=', cardId)
        .executeTakeFirstOrThrow();

      // Where it would have been anyway had it not been in the bin when the
      // date was dropped, rather than a restore that fails on a foreign key.
      expect(response.statusCode).toBe(200);
      expect(back.milestoneId).toBeNull();
    });

    it('THEN putting a legend back gathers the cards nobody has moved since', async () => {
      const legend = await makeCard('Harbour set');
      const child = await makeCard('Crane');

      await command('board.setLegend', { cardId: legend, isLegend: true });
      await command('board.putUnderLegend', { cardId: child, legendKey: 'SLTM-TASK-1' });
      await command('board.deleteCard', { cardId: legend });

      const loosened = await testDatabase.database
        .selectFrom('card')
        .select('legendId')
        .where('id', '=', child)
        .executeTakeFirstOrThrow();

      expect(loosened.legendId).toBeNull();

      const { things } = await bin();
      await command('recovery.restore', { deletedThingId: things[0]?.id });

      const regathered = await testDatabase.database
        .selectFrom('card')
        .select('legendId')
        .where('id', '=', child)
        .executeTakeFirstOrThrow();

      expect(regathered.legendId).toBe(legend);
    });
  });

  describe('WHEN an asset is deleted', () => {
    /** A category with one asset filed in it, and both their ids. */
    async function makeAsset(name: string): Promise<{ categoryId: string; assetId: string }> {
      const categoryId = (
        await command('assets.createCategory', {
          projectId,
          name: 'Environment Props',
          color: '#63aeeb',
        })
      ).json<{ id: string }>().id;
      const assetId = (await command('assets.createAsset', { projectId, categoryId, name })).json<{
        id: string;
      }>().id;

      return { categoryId, assetId };
    }

    /** Puts back the one thing in the bin that is an asset. */
    async function restoreTheAsset(): Promise<Awaited<ReturnType<typeof server.inject>>> {
      const forAsset = (await bin()).things.find((thing) => thing.what === 'Asset');

      return command('recovery.restore', { deletedThingId: forAsset?.id });
    }

    it('THEN it waits in the bin under the key people call it by', async () => {
      const { assetId } = await makeAsset('Ruined watchtower');

      await command('assets.deleteAsset', { assetId });

      expect((await bin()).things[0]).toMatchObject({
        what: 'Asset',
        name: 'Ruined watchtower',
        about: 'SLTM-AST-1',
      });
    });

    it('THEN putting it back brings what was on it', async () => {
      const { assetId } = await makeAsset('Ruined watchtower');
      const cardId = await makeCard('Retopo the watchtower');

      await command('assets.addSubtask', { assetId, title: 'Mesh' });
      await command('assets.addTag', { assetId, tag: 'act-1' });
      await command('assets.linkFile', {
        assetId,
        label: 'watchtower.blend',
        url: 'https://depot.example/watchtower.blend',
      });
      await command('assets.linkCard', { cardId, assetId });
      await command('assets.deleteAsset', { assetId });

      const restored = await restoreTheAsset();

      const read = testDatabase.database;
      const stages = await read
        .selectFrom('assetSubtask')
        .select('title')
        .where('assetId', '=', assetId)
        .execute();
      const tags = await read
        .selectFrom('assetTag')
        .select('tag')
        .where('assetId', '=', assetId)
        .execute();
      const files = await read
        .selectFrom('assetFile')
        .select('label')
        .where('assetId', '=', assetId)
        .execute();
      const links = await read
        .selectFrom('cardAssetLink')
        .select('cardId')
        .where('assetId', '=', assetId)
        .execute();

      expect(restored.statusCode).toBe(200);
      expect(stages).toEqual([{ title: 'Mesh' }]);
      expect(tags).toEqual([{ tag: 'act-1' }]);
      // A linked file points at no stored file, and comes back all the same.
      expect(files).toEqual([{ label: 'watchtower.blend' }]);
      expect(links).toEqual([{ cardId }]);
    });

    it('THEN it is refused, saying why, while the category it was in is deleted', async () => {
      const { categoryId, assetId } = await makeAsset('Ruined watchtower');

      await command('assets.deleteAsset', { assetId });
      await command('assets.deleteCategory', { categoryId });

      const refused = await restoreTheAsset();

      // A sentence somebody can act on, rather than a foreign key they cannot.
      expect(refused.statusCode).toBe(422);
      expect(refused.json<{ message: string }>().message).toContain('Put the category back first');
    });

    it('THEN putting the category back first lets the asset follow it', async () => {
      const { categoryId, assetId } = await makeAsset('Ruined watchtower');

      await command('assets.deleteAsset', { assetId });
      await command('assets.deleteCategory', { categoryId });

      const forCategory = (await bin()).things.find((thing) => thing.what === 'Asset category');
      await command('recovery.restore', { deletedThingId: forCategory?.id });

      const restored = await restoreTheAsset();

      expect(restored.statusCode).toBe(200);
      expect(await cardTitles()).toEqual([]);
      expect(
        await testDatabase.database
          .selectFrom('asset')
          .select('name')
          .where('id', '=', assetId)
          .execute(),
      ).toEqual([{ name: 'Ruined watchtower' }]);
    });
  });

  describe('WHEN the week runs out', () => {
    it('THEN the sweep throws away what is past its date and leaves the rest', async () => {
      const going = await makeTeam('Audio');
      const staying = await makeTeam('Tools');

      await command('teams.delete', { teamId: going });
      await command('teams.delete', { teamId: staying });

      // One of them is backdated so its week has already run out. The other is
      // hours old, as both were a moment ago.
      await testDatabase.database
        .updateTable('deletedThing')
        .set({ purgeAfter: new Date('2020-01-01T00:00:00.000Z') })
        .where('name', '=', 'Audio')
        .execute();

      const purged = await purgeExpired(testDatabase.database, new Date());

      expect(purged).toBe(1);

      const { things } = await bin();

      expect(things.map((thing) => thing.name)).toEqual(['Tools']);
    });

    it('THEN a thing still inside its week is given a date about a week out', async () => {
      const teamId = await makeTeam('Audio');

      await command('teams.delete', { teamId });

      const row = await testDatabase.database
        .selectFrom('deletedThing')
        .select(['deletedAt', 'purgeAfter'])
        .executeTakeFirstOrThrow();

      const days = (row.purgeAfter.getTime() - row.deletedAt.getTime()) / (24 * 60 * 60 * 1000);

      // Both come off the database's clock in one statement, so the gap is the
      // retention exactly rather than the retention plus a request.
      expect(days).toBeCloseTo(RETENTION_DAYS, 5);
    });
  });

  describe('WHEN somebody who does not run the install asks', () => {
    it('THEN they cannot see the bin, because it names things across every project', async () => {
      await testDatabase.database.updateTable('membership').set({ role: 'member' }).execute();

      // The session carries the role, so it has to be taken again.
      const memberCookie = await signIn(OWNER_EMAIL);

      const response = await server.inject({
        method: 'GET',
        url: '/api/q/recovery.deletedThings',
        cookies: { lpm_session: memberCookie },
      });

      expect(response.statusCode).toBe(403);
    });
  });
});
