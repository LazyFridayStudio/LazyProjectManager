import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import {
  DEFAULT_ASSET_CATEGORY,
  MAXIMUM_TAGS_PER_ASSET,
  type ProjectBudgetView,
  type ProjectDashboardView,
  type AssetDetailView,
  type AssetLibraryView,
  type CardDetailView,
} from '@lpm/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createServer } from '../../server/create-server.js';
import { readEnvironment } from '../../server/environment.js';
import { createStubObjectStore } from '../../storage/index.js';
import { createStubRedis } from '../../testing/index.js';
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
  return `018faaaa-0000-7000-8000-${String(commandCounter).padStart(12, '0')}`;
}

function readSessionCookie(cookies: readonly { name: string; value: string }[]): string {
  const cookie = cookies.find((candidate) => candidate.name === 'lpm_session');

  if (cookie === undefined) {
    throw new Error('Expected a session cookie to have been set.');
  }

  return cookie.value;
}

describe('GIVEN a project with things to make', () => {
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
  });

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

  async function addCategory(name: string, budgetMinor?: number): Promise<string> {
    const response = await command('assets.createCategory', {
      projectId,
      name,
      color: '#adadad',
      ...(budgetMinor === undefined ? {} : { budgetMinor }),
    });

    return response.json<{ id: string }>().id;
  }

  /** A category inside another one, which is what a library of any depth is made of. */
  async function addCategoryInside(parentId: string, name: string): Promise<string> {
    const response = await command('assets.createCategory', {
      projectId,
      parentId,
      name,
      color: '#adadad',
    });

    return response.json<{ id: string }>().id;
  }

  /** One category out of the tree, wherever it sits. */
  function findIn(
    categories: readonly AssetLibraryView['categories'][number][],
    id: string,
  ): AssetLibraryView['categories'][number] | undefined {
    for (const category of categories) {
      if (category.id === id) return category;

      const found = findIn(category.categories, id);

      if (found !== undefined) return found;
    }

    return undefined;
  }

  async function addAsset(
    categoryId: string,
    name: string,
    extra: Record<string, unknown> = {},
  ): Promise<Awaited<ReturnType<typeof server.inject>>> {
    return command('assets.createAsset', { projectId, categoryId, name, ...extra });
  }

  async function library(): Promise<AssetLibraryView> {
    const response = await server.inject({
      method: 'GET',
      url: '/api/q/assets.library?slug=saltmarsh',
      cookies: { lpm_session: ownerCookie },
    });

    return response.json<{ data: AssetLibraryView }>().data;
  }

  describe('WHEN the library has not been started', () => {
    it('THEN the screen opens with the project and no categories', async () => {
      // A project starts with none, because what a game is made of differs by
      // game. Refusing to answer would make an empty library look like an error.
      const view = await library();

      expect(view.project.name).toBe('Saltmarsh');
      expect(view.categories).toEqual([]);
    });
  });

  describe('WHEN a category is added', () => {
    it('THEN it comes back with nothing in it', async () => {
      await addCategory('Environment Props');

      const [category] = (await library()).categories;

      expect(category?.name).toBe('Environment Props');
      expect(category?.count).toBe(0);
      expect(category?.assets).toEqual([]);
      expect(category?.estimatedMinor).toBe(0);
    });

    it('THEN a second one goes after the first, rather than in front of it', async () => {
      await addCategory('Environment Props');
      await addCategory('World Bosses');

      expect((await library()).categories.map((category) => category.name)).toEqual([
        'Environment Props',
        'World Bosses',
      ]);
    });

    it('THEN a name already in use is refused, not filed twice', async () => {
      await addCategory('Environment Props');

      const response = await command('assets.createCategory', {
        projectId,
        name: 'Environment Props',
        color: '#63aeeb',
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ ok: false, code: 'CONFLICT' });
    });
  });

  describe('WHEN assets are filed under it', () => {
    it('THEN they come back in the order they were added', async () => {
      const props = await addCategory('Environment Props');
      await addAsset(props, 'Ruined watchtower');
      await addAsset(props, 'Harbour crane');

      const [category] = (await library()).categories;

      expect(category?.assets.map((asset) => asset.name)).toEqual([
        'Ruined watchtower',
        'Harbour crane',
      ]);
      expect(category?.count).toBe(2);
    });

    it('THEN one starts as a concept, because that is where a thing starts', async () => {
      const props = await addCategory('Environment Props');
      await addAsset(props, 'Ruined watchtower');

      expect((await library()).categories[0]?.assets[0]?.status).toBe('concept');
    });

    it('THEN what they are estimated to cost adds up against the budget', async () => {
      const props = await addCategory('Environment Props', 500_000);
      await addAsset(props, 'Ruined watchtower', { estimatedCostMinor: 240_000 });
      await addAsset(props, 'Harbour crane', { estimatedCostMinor: 310_000 });

      const [category] = (await library()).categories;

      expect(category?.budgetMinor).toBe(500_000);
      // Over budget is a fact to show, not an error to refuse: the estimate is
      // what it is, and somebody has to see it to do anything about it.
      expect(category?.estimatedMinor).toBe(550_000);
    });
  });

  describe('WHEN a category is put inside another one', () => {
    it('THEN the library reads as a tree rather than a list', async () => {
      const props = await addCategory('Props');
      const interior = await addCategoryInside(props, 'Interior');

      const view = await library();

      expect(view.categories).toHaveLength(1);
      expect(view.categories[0]?.categories.map((each) => each.id)).toEqual([interior]);
    });

    it('THEN it can go as deep as a studio takes it', async () => {
      const props = await addCategory('Props');
      const interior = await addCategoryInside(props, 'Interior');
      const breakable = await addCategoryInside(interior, 'Breakable');
      await addCategoryInside(breakable, 'Glass');

      const view = await library();

      expect(findIn(view.categories, breakable)?.categories.map((each) => each.name)).toEqual([
        'Glass',
      ]);
    });

    it('THEN a parent holds assets and categories at once', async () => {
      const props = await addCategory('Props');
      const interior = await addCategoryInside(props, 'Interior');
      await addAsset(props, 'Thing 1');
      await addAsset(interior, 'Car');

      const parent = (await library()).categories[0];

      expect(parent?.assets.map((asset) => asset.name)).toEqual(['Thing 1']);
      expect(parent?.categories[0]?.assets.map((asset) => asset.name)).toEqual(['Car']);
    });

    it('THEN the same name can be used under two different parents', async () => {
      const characters = await addCategory('Characters');
      const vehicles = await addCategory('Vehicles');

      await addCategoryInside(characters, 'Weapons');
      const response = await command('assets.createCategory', {
        projectId,
        parentId: vehicles,
        name: 'Weapons',
        color: '#adadad',
      });

      // Unique among siblings rather than across the project, which is the
      // whole point of having somewhere to put it.
      expect(response.statusCode).toBe(200);
    });

    it('THEN the same name twice in one place is still refused', async () => {
      const props = await addCategory('Props');
      await addCategoryInside(props, 'Interior');

      const response = await command('assets.createCategory', {
        projectId,
        parentId: props,
        name: 'Interior',
        color: '#adadad',
      });

      expect(response.statusCode).toBe(409);
    });

    it('THEN a category from another project cannot be the parent', async () => {
      const elsewhere = await command('projects.create', { name: 'Kiln', code: 'KILN' });
      const theirs = await command('assets.createCategory', {
        projectId: elsewhere.json<{ id: string }>().id,
        name: 'Theirs',
        color: '#adadad',
      });

      const response = await command('assets.createCategory', {
        projectId,
        parentId: theirs.json<{ id: string }>().id,
        name: 'Mine',
        color: '#adadad',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN what a category holds is counted', () => {
    it('THEN a parent counts everything under it, however deep', async () => {
      const props = await addCategory('Props');
      const interior = await addCategoryInside(props, 'Interior');
      const breakable = await addCategoryInside(interior, 'Breakable');

      await addAsset(props, 'Thing 1');
      await addAsset(interior, 'Chair');
      await addAsset(breakable, 'Window');

      const view = await library();

      // A parent whose assets are all in its children reading as empty is the
      // opposite of what grouping them was for.
      expect(view.categories[0]?.count).toBe(3);
      expect(findIn(view.categories, interior)?.count).toBe(2);
      expect(findIn(view.categories, breakable)?.count).toBe(1);
    });

    it('THEN what it is estimated to cost adds up the same way', async () => {
      const props = await addCategory('Props', 500_000);
      const interior = await addCategoryInside(props, 'Interior');

      await addAsset(props, 'Thing 1', { estimatedCostMinor: 100_000 });
      await addAsset(interior, 'Chair', { estimatedCostMinor: 250_000 });

      expect((await library()).categories[0]?.estimatedMinor).toBe(350_000);
    });

    it('THEN a search keeps the headings that hold what it found', async () => {
      const props = await addCategory('Props');
      const interior = await addCategoryInside(props, 'Interior');
      await addAsset(interior, 'Harbour crane');
      await addAsset(props, 'Something else');

      const response = await server.inject({
        method: 'GET',
        url: '/api/q/assets.library?slug=saltmarsh&search=harbour',
        cookies: { lpm_session: ownerCookie },
      });
      const view = response.json<{ data: AssetLibraryView }>().data;

      // A tile from nowhere is not an answer: the parents say where it was
      // found, so somebody can go there.
      expect(view.categories[0]?.id).toBe(props);
      expect(view.categories[0]?.categories[0]?.id).toBe(interior);
      expect(view.categories[0]?.categories[0]?.assets).toHaveLength(1);
    });
  });

  describe('WHEN a category is moved somewhere else in the tree', () => {
    it('THEN it becomes a child of what it was moved into', async () => {
      const props = await addCategory('Props');
      const weapons = await addCategory('Weapons');

      const response = await command('assets.moveCategory', {
        categoryId: weapons,
        parentId: props,
      });

      expect(response.statusCode).toBe(200);
      expect((await library()).categories[0]?.categories[0]?.id).toBe(weapons);
    });

    it('THEN it takes everything under it along', async () => {
      const props = await addCategory('Props');
      const weapons = await addCategory('Weapons');
      const swords = await addCategoryInside(weapons, 'Swords');

      await command('assets.moveCategory', { categoryId: weapons, parentId: props });

      const view = await library();

      expect(findIn(view.categories, weapons)?.categories[0]?.id).toBe(swords);
    });

    it('THEN it can be brought back out to the top of the library', async () => {
      const props = await addCategory('Props');
      const interior = await addCategoryInside(props, 'Interior');

      await command('assets.moveCategory', { categoryId: interior, parentId: null });

      expect((await library()).categories.map((each) => each.id)).toEqual([props, interior]);
    });

    it('THEN a move that only reorders leaves it where it lives', async () => {
      const props = await addCategory('Props');
      const first = await addCategoryInside(props, 'A');
      const second = await addCategoryInside(props, 'B');

      // No parent named at all, which is what a reorder among siblings sends.
      await command('assets.moveCategory', { categoryId: second, beforeCategoryId: first });

      expect((await library()).categories[0]?.categories.map((each) => each.id)).toEqual([
        second,
        first,
      ]);
    });

    it('THEN it cannot be put inside itself', async () => {
      const props = await addCategory('Props');

      const response = await command('assets.moveCategory', {
        categoryId: props,
        parentId: props,
      });

      expect(response.statusCode).toBe(404);
    });

    it('THEN it cannot be put inside something under it', async () => {
      const props = await addCategory('Props');
      const interior = await addCategoryInside(props, 'Interior');
      const breakable = await addCategoryInside(interior, 'Breakable');

      // A branch that leaves the library: nothing could reach it, and every
      // walk over the tree afterwards is one that does not end.
      const response = await command('assets.moveCategory', {
        categoryId: props,
        parentId: breakable,
      });

      expect(response.statusCode).toBe(404);
      expect((await library()).categories[0]?.id).toBe(props);
    });
  });

  describe('WHEN a category holding categories is deleted', () => {
    it('THEN what was inside it comes up to where it sat', async () => {
      const props = await addCategory('Props');
      const interior = await addCategoryInside(props, 'Interior');

      const response = await command('assets.deleteCategory', { categoryId: props });

      expect(response.statusCode).toBe(200);
      expect((await library()).categories.map((each) => each.id)).toContain(interior);
    });

    it('THEN a middle heading leaves the two ends joined', async () => {
      const props = await addCategory('Props');
      const interior = await addCategoryInside(props, 'Interior');
      const breakable = await addCategoryInside(interior, 'Breakable');

      await command('assets.deleteCategory', { categoryId: interior });

      // Up to the level the parent sat on, not flung out to the surface.
      expect(
        findIn((await library()).categories, props)?.categories.map((each) => each.id),
      ).toEqual([breakable]);
    });

    it('THEN it is refused when a name would collide where the children land', async () => {
      const props = await addCategory('Props');
      await addCategoryInside(props, 'Weapons');
      await addCategory('Weapons');

      const response = await command('assets.deleteCategory', { categoryId: props });

      expect(response.statusCode).toBe(422);
      expect(response.json<{ message: string }>().message).toContain('Rename one of them');
    });

    it('THEN putting it back puts what was inside it back inside it', async () => {
      const props = await addCategory('Props');
      const interior = await addCategoryInside(props, 'Interior');

      await command('assets.deleteCategory', { categoryId: props });
      const binned = await testDatabase.database
        .selectFrom('deletedThing')
        .select('id')
        .executeTakeFirstOrThrow();

      await command('recovery.restore', { deletedThingId: binned.id });

      expect(
        findIn((await library()).categories, props)?.categories.map((each) => each.id),
      ).toEqual([interior]);
    });
  });

  describe('WHEN an asset is filed somewhere it does not belong', () => {
    it("THEN another project's category is refused", async () => {
      const other = (
        await command('projects.create', { name: 'Drowned Reach', code: 'DRCH' })
      ).json<{ id: string }>().id;
      const theirs = (
        await command('assets.createCategory', {
          projectId: other,
          name: 'Environment Props',
          color: '#adadad',
        })
      ).json<{ id: string }>().id;

      const response = await addAsset(theirs, 'Ruined watchtower');

      expect(response.statusCode).toBe(404);
    });

    it('THEN a category that does not exist is refused', async () => {
      const response = await addAsset('018f0000-0000-7000-8000-000000000000', 'Nothing');

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN the same command arrives twice', () => {
    it('THEN the asset is created once', async () => {
      const props = await addCategory('Environment Props');
      const commandId = nextCommandId();
      const body = {
        commandId,
        projectId,
        categoryId: props,
        name: 'Ruined watchtower',
      };

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await server.inject({
          method: 'POST',
          url: '/api/c/assets.createAsset',
          payload: body,
          cookies: { lpm_session: ownerCookie },
        });
      }

      expect((await library()).categories[0]?.count).toBe(1);
    });
  });

  async function readAsset(assetId: string): Promise<Awaited<ReturnType<typeof server.inject>>> {
    return server.inject({
      method: 'GET',
      url: `/api/q/assets.detail?assetId=${assetId}`,
      cookies: { lpm_session: ownerCookie },
    });
  }

  async function detail(assetId: string): Promise<AssetDetailView> {
    return (await readAsset(assetId)).json<{ data: AssetDetailView }>().data;
  }

  describe('WHEN one asset is opened', () => {
    it('THEN it names the category it is filed under, not only its id', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      const view = await detail(assetId);

      expect(view.name).toBe('Ruined watchtower');
      expect(view.category.name).toBe('Environment Props');
      expect(view.project.currency).toBe('AUD');
    });

    it('THEN one that does not exist reads as one that does not exist', async () => {
      const response = await readAsset('018f0000-0000-7000-8000-000000000000');

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN an asset is changed', () => {
    it('THEN only the fields that were sent move', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (
        await addAsset(props, 'Ruined watchtower', { estimatedCostMinor: 240_000 })
      ).json<{ id: string }>().id;

      await command('assets.updateAsset', { assetId, status: 'review' });

      const view = await detail(assetId);

      expect(view.status).toBe('review');
      // Untouched, because an absent field means leave it.
      expect(view.estimatedCostMinor).toBe(240_000);
      expect(view.name).toBe('Ruined watchtower');
    });

    it('THEN it can be re-filed under another category in the same project', async () => {
      const props = await addCategory('Environment Props');
      const bosses = await addCategory('World Bosses');
      const assetId = (await addAsset(props, 'Tidewrought Leviathan')).json<{ id: string }>().id;

      await command('assets.updateAsset', { assetId, categoryId: bosses });

      expect((await detail(assetId)).category.name).toBe('World Bosses');
    });

    it("THEN it cannot be re-filed into another project's category", async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;
      const other = (
        await command('projects.create', { name: 'Drowned Reach', code: 'DRCH' })
      ).json<{ id: string }>().id;
      const theirs = (
        await command('assets.createCategory', {
          projectId: other,
          name: 'Environment Props',
          color: '#adadad',
        })
      ).json<{ id: string }>().id;

      const response = await command('assets.updateAsset', { assetId, categoryId: theirs });

      expect(response.statusCode).toBe(404);
      expect((await detail(assetId)).category.name).toBe('Environment Props');
    });

    it('THEN clearing a cost is different from leaving it alone', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (
        await addAsset(props, 'Ruined watchtower', { estimatedCostMinor: 240_000 })
      ).json<{ id: string }>().id;

      await command('assets.updateAsset', { assetId, estimatedCostMinor: null });

      expect((await detail(assetId)).estimatedCostMinor).toBeNull();
    });
  });

  describe('WHEN somebody is put on an asset', () => {
    /** In the install, and nowhere near this project. */
    async function seedTeammate(email: string): Promise<string> {
      const { accountId } = await testDatabase.database
        .selectFrom('membership')
        .select('accountId')
        .executeTakeFirstOrThrow();

      const user = await testDatabase.database
        .insertInto('appUser')
        .values({ email, passwordHash, displayName: 'Team Mate', initials: 'TM', status: 'active' })
        .returning('id')
        .executeTakeFirstOrThrow();

      await testDatabase.database
        .insertInto('membership')
        .values({ accountId, userId: user.id, role: 'member' })
        .execute();

      return user.id;
    }

    /** On the project, so an asset may name them. */
    async function seedMember(email: string): Promise<string> {
      const userId = await seedTeammate(email);

      await command('projects.addMember', { projectId, userId });

      return userId;
    }

    it('THEN it says who is making it and who asked for it', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;
      const mira = await seedMember('mira@northwind.test');
      const leo = await seedMember('leo@northwind.test');

      const response = await command('assets.updateAsset', {
        assetId,
        assigneeId: mira,
        reporterId: leo,
      });

      expect(response.statusCode).toBe(200);

      const view = await detail(assetId);

      expect(view.assignee?.userId).toBe(mira);
      expect(view.reporter?.userId).toBe(leo);
      // Named, not merely identified: a panel that had an id and no name would
      // have to fetch the whole crew to draw one row.
      expect(view.reporter?.displayName).toBe('Team Mate');
    });

    it('THEN whoever filed it is its reporter until anybody says otherwise', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      const owner = await testDatabase.database
        .selectFrom('appUser')
        .select('id')
        .where('email', '=', OWNER_EMAIL)
        .executeTakeFirstOrThrow();

      expect((await detail(assetId)).reporter?.userId).toBe(owner.id);
      // And nobody is making it yet, which is what most of a new library is.
      expect((await detail(assetId)).assignee).toBeNull();
    });

    it('THEN a reporter can be changed, because filing it is not asking for it', async () => {
      // A producer fills a library on somebody else's behalf. The person worth
      // going back to about a thin brief is the one who wanted the thing.
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;
      const mira = await seedMember('mira@northwind.test');

      await command('assets.updateAsset', { assetId, reporterId: mira });

      expect((await detail(assetId)).reporter?.userId).toBe(mira);
    });

    it('THEN taking somebody off is different from leaving them alone', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;
      const mira = await seedMember('mira@northwind.test');

      await command('assets.updateAsset', { assetId, assigneeId: mira });
      await command('assets.updateAsset', { assetId, status: 'review' });

      // The status edit did not mention them, so they stayed.
      expect((await detail(assetId)).assignee?.userId).toBe(mira);

      await command('assets.updateAsset', { assetId, assigneeId: null });

      expect((await detail(assetId)).assignee).toBeNull();
    });

    it('THEN somebody who cannot reach the project is refused', async () => {
      /*
       * An asset given to somebody who cannot open the project is work the one
       * person supposed to be doing it will never see. The picker offers
       * nobody else; this is what holds when the picker was not what put the
       * name there.
       */
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;
      const outsider = await seedTeammate('outsider@northwind.test');

      const response = await command('assets.updateAsset', { assetId, assigneeId: outsider });

      expect(response.statusCode).toBe(422);
      // And nothing was written: the check runs before the update, so an asset
      // is never briefly given to somebody who cannot open it.
      expect((await detail(assetId)).assignee).toBeNull();
    });

    it('THEN a reporter who cannot reach the project is refused the same way', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;
      const outsider = await seedTeammate('outsider@northwind.test');

      const response = await command('assets.updateAsset', { assetId, reporterId: outsider });

      expect(response.statusCode).toBe(422);
    });

    it('THEN a refused edit writes none of the rest of itself either', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;
      const outsider = await seedTeammate('outsider@northwind.test');

      await command('assets.updateAsset', { assetId, name: 'Watchtower', assigneeId: outsider });

      expect((await detail(assetId)).name).toBe('Ruined watchtower');
    });
  });

  async function addCard(title: string): Promise<string> {
    const list = await testDatabase.database
      .selectFrom('list')
      .select('id')
      .where('boardId', 'in', (builder) =>
        builder.selectFrom('board').select('id').where('projectId', '=', projectId),
      )
      .orderBy('position')
      .executeTakeFirstOrThrow();

    const response = await command('board.createCard', {
      projectId,
      listId: list.id,
      title,
      type: 'art',
    });

    return response.json<{ id: string }>().id;
  }

  async function readCard(cardId: string): Promise<CardDetailView> {
    const response = await server.inject({
      method: 'GET',
      url: `/api/q/board.cardDetail?cardId=${cardId}`,
      cookies: { lpm_session: ownerCookie },
    });

    return response.json<{ data: CardDetailView }>().data;
  }

  describe('WHEN a card is said to be about an asset', () => {
    it('THEN the card names the asset, and the asset names the card', async () => {
      // The join that makes the board and the library one product rather than
      // two screens.
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;
      const cardId = await addCard('Retopologise the watchtower');

      await command('assets.linkCard', { cardId, assetId });

      const [fromCard] = (await readCard(cardId)).assetLinks;

      expect(fromCard).toMatchObject({
        assetId,
        name: 'Ruined watchtower',
        categoryName: 'Environment Props',
        status: 'concept',
      });

      const [fromAsset] = (await detail(assetId)).cards;

      expect(fromAsset).toMatchObject({ cardId, title: 'Retopologise the watchtower' });
    });

    it('THEN saying it twice leaves one link', async () => {
      // Pressing a button again because the first press did not look like it
      // worked should give the link somebody wanted, not a message about the
      // one they already have.
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;
      const cardId = await addCard('Retopologise the watchtower');

      await command('assets.linkCard', { cardId, assetId });
      const second = await command('assets.linkCard', { cardId, assetId });

      expect(second.statusCode).toBe(200);
      expect((await readCard(cardId)).assetLinks).toHaveLength(1);
    });

    it('THEN an asset in another project cannot be linked', async () => {
      const cardId = await addCard('Retopologise the watchtower');
      const other = (
        await command('projects.create', { name: 'Drowned Reach', code: 'DRCH' })
      ).json<{ id: string }>().id;
      const theirCategory = (
        await command('assets.createCategory', {
          projectId: other,
          name: 'Environment Props',
          color: '#adadad',
        })
      ).json<{ id: string }>().id;
      const theirAsset = (
        await command('assets.createAsset', {
          projectId: other,
          categoryId: theirCategory,
          name: 'Theirs',
        })
      ).json<{ id: string }>().id;

      const response = await command('assets.linkCard', { cardId, assetId: theirAsset });

      expect(response.statusCode).toBe(404);
      expect((await readCard(cardId)).assetLinks).toEqual([]);
    });

    it('THEN unlinking leaves both the card and the asset where they are', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;
      const cardId = await addCard('Retopologise the watchtower');

      await command('assets.linkCard', { cardId, assetId });
      const [link] = (await readCard(cardId)).assetLinks;

      await command('assets.unlinkCard', { linkId: link?.linkId ?? '' });

      expect((await readCard(cardId)).assetLinks).toEqual([]);
      expect((await detail(assetId)).cards).toEqual([]);
      expect((await detail(assetId)).name).toBe('Ruined watchtower');
    });

    it('THEN unlinking something already unlinked is not an error', async () => {
      const response = await command('assets.unlinkCard', {
        linkId: '018f0000-0000-7000-8000-000000000000',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('WHEN an asset is given a key', () => {
    it('THEN it is the project code, AST, and the next number', async () => {
      const props = await addCategory('Environment Props');
      const first = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;
      const second = (await addAsset(props, 'Harbour crane')).json<{ id: string }>().id;

      // The shape a ticket key has, because it is the same idea: a short thing
      // to say out loud that is unambiguous across two projects.
      expect((await detail(first)).assetKey).toBe('SLTM-AST-1');
      expect((await detail(second)).assetKey).toBe('SLTM-AST-2');
    });

    it('THEN a number is not reused once its asset is gone', async () => {
      const props = await addCategory('Environment Props');
      await addAsset(props, 'Ruined watchtower');
      await command('assets.deleteCategory', { categoryId: props });

      const home = await addCategory('Props');
      const later = (await addAsset(home, 'Harbour crane')).json<{ id: string }>().id;

      // Deleting the category moved the first asset rather than removing it,
      // and either way the counter only goes forward.
      expect((await detail(later)).assetKey).toBe('SLTM-AST-2');
    });

    it('THEN pasting a key into the search finds the asset it names', async () => {
      const props = await addCategory('Environment Props');
      await addAsset(props, 'Ruined watchtower');
      await addAsset(props, 'Harbour crane');

      const search = new URLSearchParams({ slug: 'saltmarsh', search: 'sltm-ast-2' });
      const response = await server.inject({
        method: 'GET',
        url: `/api/q/assets.library?${search.toString()}`,
        cookies: { lpm_session: ownerCookie },
      });
      const view = response.json<{ data: AssetLibraryView }>().data;

      // Which is most of the point of having a key: somebody is handed one in a
      // stand-up and pastes it.
      expect(
        view.categories.flatMap((category) => category.assets.map((asset) => asset.name)),
      ).toEqual(['Harbour crane']);
    });
  });

  describe('WHEN the library is narrowed', () => {
    /** A project with enough in it for a filter to have something to do. */
    async function seedLibrary(): Promise<void> {
      const props = await addCategory('Environment Props');
      const bosses = await addCategory('World Bosses');

      const watchtower = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;
      const crane = (await addAsset(props, 'Harbour crane')).json<{ id: string }>().id;
      const leviathan = (await addAsset(bosses, 'Tidewrought Leviathan')).json<{ id: string }>().id;

      await command('assets.updateAsset', { assetId: watchtower, status: 'approved' });
      await command('assets.updateAsset', { assetId: crane, status: 'review' });
      await command('assets.updateAsset', { assetId: leviathan, status: 'review' });

      await command('assets.addTag', { assetId: watchtower, tag: 'act-1' });
      await command('assets.addTag', { assetId: watchtower, tag: 'modular' });
      await command('assets.addTag', { assetId: crane, tag: 'act-1' });
      await command('assets.addTag', { assetId: leviathan, tag: 'boss' });
    }

    /** Every asset the library returns, whichever category it is under. */
    function shownIn(view: AssetLibraryView): string[] {
      return view.categories.flatMap((category) => category.assets.map((asset) => asset.name));
    }

    async function filtered(params: Record<string, string>): Promise<AssetLibraryView> {
      const search = new URLSearchParams({ slug: 'saltmarsh', ...params });
      const response = await server.inject({
        method: 'GET',
        url: `/api/q/assets.library?${search.toString()}`,
        cookies: { lpm_session: ownerCookie },
      });

      return response.json<{ data: AssetLibraryView }>().data;
    }

    it('THEN a search matches the name, either case', async () => {
      await seedLibrary();

      expect(shownIn(await filtered({ search: 'harbour' }))).toEqual(['Harbour crane']);
      expect(shownIn(await filtered({ search: 'CRANE' }))).toEqual(['Harbour crane']);
    });

    it('THEN the count beside a category means what is under it', async () => {
      await seedLibrary();

      const view = await filtered({ search: 'harbour' });
      const [category] = view.categories;

      // A screen that filtered the tiles and left the counts alone would say
      // two and show one.
      expect(category?.count).toBe(1);
      expect(category?.assets).toHaveLength(1);
    });

    it('THEN a status narrows across every category', async () => {
      await seedLibrary();

      expect(shownIn(await filtered({ statuses: 'review' })).sort()).toEqual([
        'Harbour crane',
        'Tidewrought Leviathan',
      ]);
    });

    it('THEN tags are combined with AND, as the design says', async () => {
      await seedLibrary();

      // Both carry act-1; only the watchtower carries modular as well.
      expect(shownIn(await filtered({ tags: 'act-1' })).sort()).toEqual([
        'Harbour crane',
        'Ruined watchtower',
      ]);
      expect(shownIn(await filtered({ tags: 'act-1,modular' }))).toEqual(['Ruined watchtower']);
      expect(shownIn(await filtered({ tags: 'act-1,boss' }))).toEqual([]);
    });

    it('THEN a category with nothing left in it steps out of the way', async () => {
      await seedLibrary();

      const view = await filtered({ search: 'harbour' });

      // Eight empty headings are what stands between a search and its answer.
      expect(view.categories.map((category) => category.name)).toEqual(['Environment Props']);
    });

    it('THEN the header still knows how big the library really is', async () => {
      await seedLibrary();

      const view = await filtered({ search: 'harbour' });

      // "1 of 3", rather than telling somebody their library shrank.
      expect(view.assetCount).toBe(3);
      expect(view.availableTags).toEqual(['act-1', 'boss', 'modular']);
    });

    it('THEN asking for nothing in particular returns the whole library', async () => {
      await seedLibrary();

      const view = await filtered({});

      expect(shownIn(view)).toHaveLength(3);
      expect(view.categories).toHaveLength(2);
    });
  });

  describe('WHEN a category is changed or taken out of the library', () => {
    /** The categories a project has, in the order the library draws them. */
    async function categoryNames(): Promise<string[]> {
      return (await library()).categories.map((category) => category.name);
    }

    it('THEN editing one leaves what it holds where it is', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      await command('assets.updateCategory', {
        categoryId: props,
        name: 'Props',
        color: '#63aeeb',
        budgetMinor: 500_000,
      });

      const [category] = (await library()).categories;

      expect(category).toMatchObject({ name: 'Props', color: '#63aeeb', budgetMinor: 500_000 });
      expect((await detail(assetId)).category.name).toBe('Props');
    });

    it('THEN a name another category already has is refused', async () => {
      const props = await addCategory('Environment Props');
      await addCategory('World Bosses');

      const response = await command('assets.updateCategory', {
        categoryId: props,
        name: 'World Bosses',
      });

      expect(response.statusCode).toBe(409);
      expect(await categoryNames()).toEqual(['Environment Props', 'World Bosses']);
    });

    it('THEN deleting an empty one takes nothing with it', async () => {
      const props = await addCategory('Environment Props');

      await command('assets.deleteCategory', { categoryId: props });

      expect(await categoryNames()).toEqual([]);
    });

    it('THEN what it held moves to Unorganised rather than being thrown away', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      await command('assets.deleteCategory', { categoryId: props });

      // A category is how a studio files things, and refiling is not the same
      // as throwing away.
      expect(await categoryNames()).toEqual([DEFAULT_ASSET_CATEGORY.name]);
      expect((await detail(assetId)).category.name).toBe(DEFAULT_ASSET_CATEGORY.name);
      expect((await library()).categories[0]?.count).toBe(1);
    });

    it('THEN a second delete reuses the one Unorganised rather than making another', async () => {
      const props = await addCategory('Environment Props');
      const bosses = await addCategory('World Bosses');
      await addAsset(props, 'Ruined watchtower');
      await addAsset(bosses, 'Tidewrought Leviathan');

      await command('assets.deleteCategory', { categoryId: props });
      await command('assets.deleteCategory', { categoryId: bosses });

      expect(await categoryNames()).toEqual([DEFAULT_ASSET_CATEGORY.name]);
      expect((await library()).categories[0]?.count).toBe(2);
    });

    it('THEN Unorganised itself cannot be deleted while it still holds things', async () => {
      const props = await addCategory('Environment Props');
      await addAsset(props, 'Ruined watchtower');
      await command('assets.deleteCategory', { categoryId: props });

      const [unorganised] = (await library()).categories;
      const response = await command('assets.deleteCategory', {
        categoryId: unorganised?.id ?? '',
      });

      // It is where things go. A rule that deleted the destination would be a
      // rule that lost the assets.
      expect(response.statusCode).toBe(422);
      expect((await library()).categories[0]?.count).toBe(1);
    });

    it('THEN Unorganised goes like any other category once it is empty', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;
      await command('assets.deleteCategory', { categoryId: props });

      const [unorganised] = (await library()).categories;
      const home = await addCategory('Props');

      await command('assets.updateAsset', { assetId, categoryId: home });
      await command('assets.deleteCategory', { categoryId: unorganised?.id ?? '' });

      expect(await categoryNames()).toEqual(['Props']);
    });

    it('THEN a category from another account is refused', async () => {
      const response = await command('assets.deleteCategory', {
        categoryId: '018f0000-0000-7000-8000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN an asset is filed under a word', () => {
    it('THEN the tag shows on the panel and on the tile, alphabetical', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      await command('assets.addTag', { assetId, tag: 'stone' });
      await command('assets.addTag', { assetId, tag: 'modular' });

      // Alphabetical, because a row of chips is scanned rather than read in the
      // order somebody happened to type them.
      expect((await detail(assetId)).tags).toEqual(['modular', 'stone']);
      expect((await library()).categories[0]?.assets[0]?.tags).toEqual(['modular', 'stone']);
    });

    it('THEN what somebody typed is normalised, so one tag is one tag', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      await command('assets.addTag', { assetId, tag: 'Act 1' });
      await command('assets.addTag', { assetId, tag: 'ACT_1' });

      expect((await detail(assetId)).tags).toEqual(['act-1']);
    });

    it('THEN asking twice is not an error, the way linking twice is not', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      await command('assets.addTag', { assetId, tag: 'stone' });
      const again = await command('assets.addTag', { assetId, tag: 'stone' });

      expect(again.statusCode).toBe(200);
      expect((await detail(assetId)).tags).toEqual(['stone']);
    });

    it('THEN taking one off leaves the rest, and taking off one that is gone is fine', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      await command('assets.addTag', { assetId, tag: 'stone' });
      await command('assets.addTag', { assetId, tag: 'modular' });
      await command('assets.removeTag', { assetId, tag: 'stone' });

      expect((await detail(assetId)).tags).toEqual(['modular']);

      const missing = await command('assets.removeTag', { assetId, tag: 'stone' });

      expect(missing.statusCode).toBe(200);
    });

    it('THEN an asset stops taking them once the tile would be a wall of chips', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      for (let index = 0; index < MAXIMUM_TAGS_PER_ASSET; index += 1) {
        await command('assets.addTag', { assetId, tag: `tag-${String(index)}` });
      }

      const tooMany = await command('assets.addTag', { assetId, tag: 'one-more' });

      expect(tooMany.statusCode).toBe(422);
      expect((await detail(assetId)).tags).toHaveLength(MAXIMUM_TAGS_PER_ASSET);
    });

    it('THEN an asset from another account is refused', async () => {
      const response = await command('assets.addTag', {
        assetId: '018f0000-0000-7000-8000-000000000000',
        tag: 'stone',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN an asset is dragged into a new place', () => {
    let props: string;
    let characters: string;

    async function namesIn(categoryName: string): Promise<string[]> {
      const category = (await library()).categories.find((each) => each.name === categoryName);

      return (category?.assets ?? []).map((asset) => asset.name);
    }

    async function idOf(name: string): Promise<string> {
      const found = (await library()).categories
        .flatMap((category) => category.assets)
        .find((asset) => asset.name === name);

      if (found === undefined) throw new Error(`No asset called ${name}.`);

      return found.id;
    }

    beforeEach(async () => {
      props = await addCategory('Environment Props');
      characters = await addCategory('Characters');

      await addAsset(props, 'Watchtower');
      await addAsset(props, 'Crane');
      await addAsset(props, 'Lantern');
    });

    it('THEN it lands where it was dropped rather than at the end', async () => {
      await command('assets.move', {
        assetId: await idOf('Lantern'),
        toCategoryId: props,
        beforeAssetId: await idOf('Crane'),
        afterAssetId: await idOf('Watchtower'),
      });

      expect(await namesIn('Environment Props')).toEqual(['Watchtower', 'Lantern', 'Crane']);
    });

    it('THEN dropping it at the front puts it first', async () => {
      await command('assets.move', {
        assetId: await idOf('Lantern'),
        toCategoryId: props,
        beforeAssetId: await idOf('Watchtower'),
        afterAssetId: null,
      });

      expect(await namesIn('Environment Props')).toEqual(['Lantern', 'Watchtower', 'Crane']);
    });

    it('THEN naming neither side sends it to the end', async () => {
      await command('assets.move', {
        assetId: await idOf('Watchtower'),
        toCategoryId: props,
      });

      expect(await namesIn('Environment Props')).toEqual(['Crane', 'Lantern', 'Watchtower']);
    });

    it('THEN dragging it into another category moves it there, where it was dropped', async () => {
      await addAsset(characters, 'Sentinel');
      await addAsset(characters, 'Diver');

      await command('assets.move', {
        assetId: await idOf('Crane'),
        toCategoryId: characters,
        beforeAssetId: await idOf('Diver'),
        afterAssetId: await idOf('Sentinel'),
      });

      expect(await namesIn('Characters')).toEqual(['Sentinel', 'Crane', 'Diver']);
      // And it is no longer where it came from, because this is a move.
      expect(await namesIn('Environment Props')).toEqual(['Watchtower', 'Lantern']);
    });

    it('THEN the order survives being read again, because it is stored', async () => {
      await command('assets.move', {
        assetId: await idOf('Lantern'),
        toCategoryId: props,
        beforeAssetId: await idOf('Watchtower'),
      });

      expect(await namesIn('Environment Props')).toEqual(await namesIn('Environment Props'));
      expect((await namesIn('Environment Props'))[0]).toBe('Lantern');
    });

    it('THEN a category belonging to another project is refused', async () => {
      const elsewhere = (
        await command('projects.create', { name: 'Other Game', code: 'OTHR' })
      ).json<{ id: string }>().id;
      const theirs = (
        await command('assets.createCategory', {
          projectId: elsewhere,
          name: 'Theirs',
          color: '#adadad',
        })
      ).json<{ id: string }>().id;

      const response = await command('assets.move', {
        assetId: await idOf('Crane'),
        toCategoryId: theirs,
      });

      // Otherwise an id from another project would carry an asset out of the
      // library it belongs to, and the screen it left would just stop showing it.
      expect(response.statusCode).toBe(404);
      expect(await namesIn('Environment Props')).toContain('Crane');
    });

    it('THEN an asset from another account is refused', async () => {
      const response = await command('assets.move', {
        assetId: '018f0000-0000-7000-8000-000000000000',
        toCategoryId: props,
      });

      expect(response.statusCode).toBe(404);
    });

    it('THEN the same move sent twice moves it once', async () => {
      const commandId = nextCommandId();
      const assetId = await idOf('Lantern');
      const beforeAssetId = await idOf('Watchtower');

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await server.inject({
          method: 'POST',
          url: '/api/c/assets.move',
          payload: { commandId, assetId, toCategoryId: props, beforeAssetId },
          cookies: { lpm_session: ownerCookie },
        });
      }

      expect(await namesIn('Environment Props')).toEqual(['Lantern', 'Watchtower', 'Crane']);
    });
  });

  /**
   * The order the headings read in is the order a studio thinks about what it
   * is making.
   *
   * Until this it was the order the categories happened to be made in, which is
   * the order somebody thought of them on the first afternoon. The arithmetic
   * is the one every hand-ordered list here uses; what is worth testing is that
   * a category is ordered among its own project's and not among a neighbour's.
   */
  describe('WHEN a category is dragged up or down the library', () => {
    let props: string;
    let characters: string;
    let interfaceCategory: string;

    async function headings(): Promise<string[]> {
      return (await library()).categories.map((category) => category.name);
    }

    beforeEach(async () => {
      props = await addCategory('Environment Props');
      characters = await addCategory('Characters');
      interfaceCategory = await addCategory('Interface');
    });

    it('THEN it lands where it was dropped rather than staying where it was made', async () => {
      await command('assets.moveCategory', {
        categoryId: interfaceCategory,
        beforeCategoryId: characters,
        afterCategoryId: props,
      });

      expect(await headings()).toEqual(['Environment Props', 'Interface', 'Characters']);
    });

    it('THEN dropping it at the top puts it first', async () => {
      await command('assets.moveCategory', {
        categoryId: interfaceCategory,
        beforeCategoryId: props,
        afterCategoryId: null,
      });

      expect(await headings()).toEqual(['Interface', 'Environment Props', 'Characters']);
    });

    it('THEN naming neither side sends it to the end', async () => {
      await command('assets.moveCategory', { categoryId: props });

      expect(await headings()).toEqual(['Characters', 'Interface', 'Environment Props']);
    });

    it('THEN the order survives being read again, because it is stored', async () => {
      await command('assets.moveCategory', {
        categoryId: interfaceCategory,
        beforeCategoryId: props,
      });

      expect(await headings()).toEqual(await headings());
      expect((await headings())[0]).toBe('Interface');
    });

    it('THEN a neighbour from another project is ignored rather than refusing the drop', async () => {
      // A neighbour is advice about where to land, not a row being written. One
      // that is not in this library is simply not among the siblings, and the
      // end is where something goes when nothing says otherwise — refusing
      // would mean a drop failing because somebody deleted a heading a moment
      // earlier.
      const elsewhere = (
        await command('projects.create', { name: 'Other Game', code: 'OTHR' })
      ).json<{ id: string }>().id;
      const theirs = (
        await command('assets.createCategory', {
          projectId: elsewhere,
          name: 'Theirs',
          color: '#adadad',
        })
      ).json<{ id: string }>().id;

      const response = await command('assets.moveCategory', {
        categoryId: props,
        beforeCategoryId: theirs,
      });

      expect(response.statusCode).toBe(200);
      expect(await headings()).toEqual(['Characters', 'Interface', 'Environment Props']);
    });

    it('THEN a category from another account is refused', async () => {
      const response = await command('assets.moveCategory', {
        categoryId: '018f0000-0000-7000-8000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });

    it('THEN it is on the audit trail', async () => {
      await command('assets.moveCategory', {
        categoryId: interfaceCategory,
        beforeCategoryId: props,
      });

      const events = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .where('name', '=', 'assets.categoryMoved')
        .execute();

      expect(events).toHaveLength(1);
    });

    it('THEN the same move sent twice moves it once', async () => {
      const commandId = nextCommandId();

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await server.inject({
          method: 'POST',
          url: '/api/c/assets.moveCategory',
          payload: { commandId, categoryId: interfaceCategory, beforeCategoryId: props },
          cookies: { lpm_session: ownerCookie },
        });
      }

      expect(await headings()).toEqual(['Interface', 'Environment Props', 'Characters']);
    });
  });

  describe('WHEN an asset is broken into the stages it is made in', () => {
    let charactersId: string;

    beforeEach(async () => {
      charactersId = await addCategory('Characters');
    });

    async function stagedAsset(name = 'Drowned sentinel'): Promise<string> {
      return (await addAsset(charactersId, name)).json<{ id: string }>().id;
    }

    async function addStage(assetId: string, title: string): Promise<string> {
      const response = await command('assets.addSubtask', { assetId, title });

      return response.json<{ id: string }>().id;
    }

    it('THEN they come back in the order somebody put them, not alphabetical', async () => {
      const assetId = await stagedAsset();

      await addStage(assetId, 'Mesh');
      await addStage(assetId, 'UV');
      await addStage(assetId, 'Texture');
      await addStage(assetId, 'Animation');

      // The list is a pipeline. Somebody who puts UV above Texture means it to
      // stay there, and a checklist that reordered itself would not be trusted.
      expect((await detail(assetId)).subtasks.map((stage) => stage.title)).toEqual([
        'Mesh',
        'UV',
        'Texture',
        'Animation',
      ]);
    });

    it('THEN a new stage is not done yet', async () => {
      const assetId = await stagedAsset();

      await addStage(assetId, 'Mesh');

      expect((await detail(assetId)).subtasks[0]?.done).toBe(false);
    });

    it('THEN ticking one off leaves the others alone', async () => {
      const assetId = await stagedAsset();
      const mesh = await addStage(assetId, 'Mesh');

      await addStage(assetId, 'UV');
      await command('assets.updateSubtask', { assetSubtaskId: mesh, done: true });

      expect((await detail(assetId)).subtasks).toMatchObject([
        { title: 'Mesh', done: true },
        { title: 'UV', done: false },
      ]);
    });

    it('THEN one can be unticked again, because work comes back', async () => {
      const assetId = await stagedAsset();
      const mesh = await addStage(assetId, 'Mesh');

      await command('assets.updateSubtask', { assetSubtaskId: mesh, done: true });
      await command('assets.updateSubtask', { assetSubtaskId: mesh, done: false });

      expect((await detail(assetId)).subtasks[0]?.done).toBe(false);
    });

    it('THEN renaming one keeps whether it was done', async () => {
      const assetId = await stagedAsset();
      const stage = await addStage(assetId, 'Textures');

      await command('assets.updateSubtask', { assetSubtaskId: stage, done: true });
      await command('assets.updateSubtask', { assetSubtaskId: stage, title: 'Texture' });

      expect((await detail(assetId)).subtasks[0]).toMatchObject({
        title: 'Texture',
        done: true,
      });
    });

    it('THEN a change that says nothing is refused rather than silently doing nothing', async () => {
      const assetId = await stagedAsset();
      const stage = await addStage(assetId, 'Mesh');

      const response = await command('assets.updateSubtask', { assetSubtaskId: stage });

      expect(response.statusCode).toBe(422);
    });

    it('THEN removing one really does remove it, because a stage is a working note', async () => {
      const assetId = await stagedAsset();
      const mesh = await addStage(assetId, 'Mesh');

      await addStage(assetId, 'UV');
      await command('assets.removeSubtask', { assetSubtaskId: mesh });

      expect((await detail(assetId)).subtasks.map((stage) => stage.title)).toEqual(['UV']);
    });

    it('THEN the tile counts them, so a library says how far along things are', async () => {
      const assetId = await stagedAsset();
      const mesh = await addStage(assetId, 'Mesh');

      await addStage(assetId, 'UV');
      await addStage(assetId, 'Texture');
      await command('assets.updateSubtask', { assetSubtaskId: mesh, done: true });

      const tile = (await library()).categories[0]?.assets[0];

      expect(tile).toMatchObject({ subtaskCount: 3, subtasksDone: 1 });
    });

    it('THEN an asset nobody has broken up counts nought of nought', async () => {
      const assetId = await stagedAsset();

      // Which the tile draws as nothing at all rather than as 0/0: a library
      // where most things are one job would otherwise be a column of noise.
      expect((await library()).categories[0]?.assets[0]).toMatchObject({
        subtaskCount: 0,
        subtasksDone: 0,
      });
      expect((await detail(assetId)).subtasks).toEqual([]);
    });

    it('THEN one asset’s stages are its own', async () => {
      const first = await stagedAsset('Drowned sentinel');
      const second = await stagedAsset('Harbour lantern');

      await addStage(first, 'Mesh');

      expect((await detail(second)).subtasks).toEqual([]);
    });

    it('THEN the same add sent twice adds one stage, not two', async () => {
      const assetId = await stagedAsset();
      const commandId = nextCommandId();

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await server.inject({
          method: 'POST',
          url: '/api/c/assets.addSubtask',
          payload: { commandId, assetId, title: 'Mesh' },
          cookies: { lpm_session: ownerCookie },
        });
      }

      expect((await detail(assetId)).subtasks).toHaveLength(1);
    });

    it('THEN an asset from another account is refused', async () => {
      const response = await command('assets.addSubtask', {
        assetId: '018f0000-0000-7000-8000-000000000000',
        title: 'Mesh',
      });

      expect(response.statusCode).toBe(404);
    });

    it('THEN a stage that is not there is refused the same way', async () => {
      const response = await command('assets.updateSubtask', {
        assetSubtaskId: '018f0000-0000-7000-8000-000000000000',
        done: true,
      });

      expect(response.statusCode).toBe(404);
    });

    it('THEN removing the asset takes its stages with it', async () => {
      const assetId = await stagedAsset();

      await addStage(assetId, 'Mesh');
      await testDatabase.database.deleteFrom('asset').where('id', '=', assetId).execute();

      // The cascade is for a project being removed underneath it. An asset
      // archives rather than deletes, so this is the only way they go.
      const left = await testDatabase.database
        .selectFrom('assetSubtask')
        .select('id')
        .where('assetId', '=', assetId)
        .execute();

      expect(left).toEqual([]);
    });
  });

  describe('WHEN an asset is given reference images', () => {
    /** Uploads one, and tells the worker's part of the story for it. */
    async function addReference(assetId: string, filename: string): Promise<string> {
      const fileId = (
        await command('files.requestUpload', {
          target: { kind: 'assetReference', assetId },
          filename,
          mime: 'image/png',
          bytes: 240_000,
        })
      ).json<{ id: string }>().id;

      // The thumbnail is what both the sheet and the tile draw, and the worker
      // makes it — until then there is a file but nothing small enough to put on
      // a wall of them.
      await testDatabase.database
        .updateTable('file')
        .set({ state: 'stored', thumbnailKey: `thumbnails/${filename}.webp` })
        .where('id', '=', fileId)
        .execute();

      return fileId;
    }

    it('THEN a picture shows the moment it is uploaded, before the worker has thumbnailed it', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      const fileId = (
        await command('files.requestUpload', {
          target: { kind: 'assetReference', assetId },
          filename: 'silhouette.png',
          mime: 'image/png',
          bytes: 240_000,
        })
      ).json<{ id: string }>().id;

      // Stored, but no thumbnail: exactly the state every upload is in for the
      // first seconds of its life, and the state the panel used to draw a
      // filename for until somebody closed and reopened it.
      await testDatabase.database
        .updateTable('file')
        .set({ state: 'stored' })
        .where('id', '=', fileId)
        .execute();

      const [reference] = (await detail(assetId)).references;

      expect(reference?.url).not.toBeNull();
      expect((await library()).categories[0]?.assets[0]?.primaryReferenceUrl).not.toBeNull();
    });

    it('THEN nothing is offered for one whose upload never finished', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      await command('files.requestUpload', {
        target: { kind: 'assetReference', assetId },
        filename: 'silhouette.png',
        mime: 'image/png',
        bytes: 240_000,
      });

      // Still `pending`: a link here would point at an object that never
      // arrived, which is a broken image rather than an honest filename.
      const [reference] = (await detail(assetId)).references;

      expect(reference?.url).toBeNull();
      expect((await library()).categories[0]?.assets[0]?.primaryReferenceUrl).toBeNull();
    });

    it('THEN they gather rather than replace, in the order they were added', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      // Nothing until somebody uploads one, rather than a broken image.
      expect((await detail(assetId)).references).toEqual([]);
      expect((await library()).categories[0]?.assets[0]?.primaryReferenceUrl).toBeNull();

      await addReference(assetId, 'silhouette');
      await addReference(assetId, 'colour-keys');
      await addReference(assetId, 'scale-ref');

      const references = (await detail(assetId)).references;

      expect(references.map((reference) => reference.filename)).toEqual([
        'silhouette',
        'colour-keys',
        'scale-ref',
      ]);
      // The file's own address. Which of the two objects behind it gets sent —
      // the thumbnail, or the original until the worker has made one — is the
      // file route's decision, and not something a view model states.
      expect(references[0]?.url).toMatch(/^\/api\/f\/[0-9a-f-]{36}$/u);
    });

    it('THEN the tile shows the first of them, and says how many there are', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      await addReference(assetId, 'silhouette');
      await addReference(assetId, 'colour-keys');

      const tile = (await library()).categories[0]?.assets[0];

      // The first one, not the newest: adding a second picture must not quietly
      // change what the asset looks like from the library.
      const first = (await detail(assetId)).references[0];

      expect(tile?.primaryReferenceUrl).toBe(first?.url);
      expect(tile?.referenceCount).toBe(2);
    });

    /** A sheet of three, in the order they were added. */
    async function sheetOfThree(): Promise<{ assetId: string; ids: string[] }> {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      for (const name of ['silhouette', 'colour-keys', 'scale-ref']) {
        await addReference(assetId, name);
      }

      return {
        assetId,
        ids: (await detail(assetId)).references.map((reference) => reference.id),
      };
    }

    async function filenamesOf(assetId: string): Promise<string[]> {
      return (await detail(assetId)).references.map((reference) => reference.filename);
    }

    it('THEN dragging one lands it between the two it was dropped between', async () => {
      const { assetId, ids } = await sheetOfThree();

      await command('assets.moveReference', {
        referenceId: ids[2],
        beforeReferenceId: ids[1],
        afterReferenceId: ids[0],
      });

      expect(await filenamesOf(assetId)).toEqual(['silhouette', 'scale-ref', 'colour-keys']);
    });

    it('THEN dropping one at the front is the same act as promoting it', async () => {
      const { assetId, ids } = await sheetOfThree();

      // The first picture is what the library tile draws, so the drag and the
      // button in the corner do the same thing.
      await command('assets.moveReference', {
        referenceId: ids[2],
        beforeReferenceId: ids[0],
        afterReferenceId: null,
      });

      expect(await filenamesOf(assetId)).toEqual(['scale-ref', 'silhouette', 'colour-keys']);
    });

    it('THEN dropping one at the end puts it last', async () => {
      const { assetId, ids } = await sheetOfThree();

      await command('assets.moveReference', {
        referenceId: ids[0],
        beforeReferenceId: null,
        afterReferenceId: ids[2],
      });

      expect(await filenamesOf(assetId)).toEqual(['colour-keys', 'scale-ref', 'silhouette']);
    });

    it('THEN a neighbour from another sheet is refused rather than ignored', async () => {
      const { assetId, ids } = await sheetOfThree();
      const props = await addCategory('World Bosses');
      const other = (await addAsset(props, 'Tidecaller')).json<{ id: string }>().id;

      await addReference(other, 'tidecaller');
      const [stranger] = (await detail(other)).references;

      const response = await command('assets.moveReference', {
        referenceId: ids[2],
        beforeReferenceId: stranger?.id,
      });

      // Ignoring it would leave the move unbounded, which lands the picture on
      // the same position as whatever is first — an order nothing can answer
      // for. Both sheets are left as they were.
      expect(response.statusCode).toBe(404);
      expect(await filenamesOf(assetId)).toEqual(['silhouette', 'colour-keys', 'scale-ref']);
      expect(await filenamesOf(other)).toEqual(['tidecaller']);
    });

    it('THEN promoting one puts it first, which is what the tile then draws', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      await addReference(assetId, 'silhouette');
      await addReference(assetId, 'colour-keys');

      const [, second] = (await detail(assetId)).references;

      await command('assets.promoteReference', { referenceId: second?.id ?? '' });

      expect((await detail(assetId)).references.map((reference) => reference.filename)).toEqual([
        'colour-keys',
        'silhouette',
      ]);
      // Whatever is first on the sheet is what the tile draws, which is now the
      // picture that was promoted.
      const promoted = (await detail(assetId)).references[0];

      expect((await library()).categories[0]?.assets[0]?.primaryReferenceUrl).toBe(promoted?.url);
    });

    it('THEN removing one leaves the file, because something else may point at it', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;
      const fileId = await addReference(assetId, 'silhouette');

      const [reference] = (await detail(assetId)).references;

      await command('assets.removeReference', { referenceId: reference?.id ?? '' });

      expect((await detail(assetId)).references).toEqual([]);

      const file = await testDatabase.database
        .selectFrom('file')
        .select('id')
        .where('id', '=', fileId)
        .executeTakeFirst();

      expect(file).toBeDefined();
    });

    it('THEN a tile says how much work hangs off the asset', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      expect((await library()).categories[0]?.assets[0]?.linkedCardCount).toBe(0);

      const cardId = await addCard('Retopologise the watchtower');
      await command('assets.linkCard', { cardId, assetId });

      expect((await library()).categories[0]?.assets[0]?.linkedCardCount).toBe(1);
    });

    it('THEN anything that is not a picture is refused, and pointed at the files list', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      const response = await command('files.requestUpload', {
        target: { kind: 'assetReference', assetId },
        filename: 'watchtower_hi.blend',
        mime: 'application/octet-stream',
        bytes: 48_000_000,
      });

      // The sheet is a sheet of pictures, and one of them is the asset's
      // thumbnail. A `.blend` here is a tile with a filename where a picture
      // should be.
      expect(response.statusCode).toBe(422);
      expect((await detail(assetId)).references).toEqual([]);
    });

    it('THEN an SVG counts as a picture, because everything else here treats one as an image', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      const response = await command('files.requestUpload', {
        target: { kind: 'assetReference', assetId },
        filename: 'icons.svg',
        mime: 'image/svg+xml',
        bytes: 4_000,
      });

      expect(response.statusCode).toBe(200);
    });

    it('THEN an asset in a project the caller cannot reach is refused', async () => {
      const response = await command('files.requestUpload', {
        target: { kind: 'assetReference', assetId: '018f0000-0000-7000-8000-000000000000' },
        filename: 'watchtower.png',
        mime: 'image/png',
        bytes: 240_000,
      });

      expect(response.statusCode).toBe(404);
    });

    it('THEN a reference from another account is refused, the same way its asset would be', async () => {
      const response = await command('assets.removeReference', {
        referenceId: '018f0000-0000-7000-8000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN an asset is given the files it is made of', () => {
    it('THEN it takes whatever a studio works in, unlike the reference sheet', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      const response = await command('files.requestUpload', {
        target: { kind: 'assetFile', assetId },
        filename: 'watchtower_hi.blend',
        mime: 'application/octet-stream',
        bytes: 48_000_000,
      });

      expect(response.statusCode).toBe(200);
    });

    it('THEN an upload joins the list under the name it came with', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      expect((await detail(assetId)).files).toEqual([]);

      const fileId = (
        await command('files.requestUpload', {
          target: { kind: 'assetFile', assetId },
          filename: 'watchtower_hi.blend',
          mime: 'application/octet-stream',
          bytes: 48_000_000,
        })
      ).json<{ id: string }>().id;

      await testDatabase.database
        .updateTable('file')
        .set({ state: 'stored', bytes: 48_000_000 })
        .where('id', '=', fileId)
        .execute();

      const [file] = (await detail(assetId)).files;

      expect(file).toMatchObject({
        label: 'watchtower_hi.blend',
        stored: true,
        bytes: 48_000_000,
      });
      // A stable address rather than a signature: a panel left open over lunch
      // would otherwise hand back a download that refuses.
      expect(file?.href).toBe(`/api/f/${fileId}?full`);
    });

    it('THEN a file that lives somewhere else is held as a link, not a copy', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      await command('assets.linkFile', {
        assetId,
        label: 'Watchtower source',
        url: 'https://depot.example.test/art/watchtower_hi.blend',
      });

      const [file] = (await detail(assetId)).files;

      expect(file).toMatchObject({
        label: 'Watchtower source',
        href: 'https://depot.example.test/art/watchtower_hi.blend',
        stored: false,
        bytes: null,
      });
    });

    it('THEN the two kinds sit in one list, in the order they were added', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      await command('files.requestUpload', {
        target: { kind: 'assetFile', assetId },
        filename: 'watchtower_hi.blend',
        mime: 'application/octet-stream',
        bytes: 48_000_000,
      });
      await command('assets.linkFile', {
        assetId,
        label: 'Substance graph',
        url: 'https://depot.example.test/art/watchtower.sbs',
      });

      expect((await detail(assetId)).files.map((file) => file.label)).toEqual([
        'watchtower_hi.blend',
        'Substance graph',
      ]);
    });

    it('THEN an address that is not somewhere a colleague can be sent is refused', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      // The oldest trick there is, and a path on whichever machine happens to
      // be reading it. Neither is a place anybody can go.
      for (const url of ['javascript:alert(1)', 'file:///C:/art/watchtower.blend', 'not a url']) {
        const response = await command('assets.linkFile', { assetId, label: 'Source', url });

        expect(response.statusCode).toBe(422);
      }

      expect((await detail(assetId)).files).toEqual([]);
    });

    it('THEN removing an uploaded one leaves the bytes, because something else may point at them', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      const fileId = (
        await command('files.requestUpload', {
          target: { kind: 'assetFile', assetId },
          filename: 'watchtower_hi.blend',
          mime: 'application/octet-stream',
          bytes: 48_000_000,
        })
      ).json<{ id: string }>().id;

      const [file] = (await detail(assetId)).files;

      await command('assets.removeFile', { assetFileId: file?.id ?? '' });

      expect((await detail(assetId)).files).toEqual([]);

      const stillThere = await testDatabase.database
        .selectFrom('file')
        .select('id')
        .where('id', '=', fileId)
        .executeTakeFirst();

      expect(stillThere).toBeDefined();
    });

    it('THEN a file on an asset from another account is refused', async () => {
      const response = await command('assets.removeFile', {
        assetFileId: '018f0000-0000-7000-8000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN the sidebar asks what a project holds', () => {
    async function workspace(): Promise<{
      assetCount: number;
      openCardCount: number;
      categories: { id: string; depth: number; name: string; count: number; color: string }[];
    }> {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/projects.workspace?slug=saltmarsh',
        cookies: { lpm_session: ownerCookie },
      });

      return response.json<{
        data: {
          assetCount: number;
          openCardCount: number;
          categories: { id: string; depth: number; name: string; count: number; color: string }[];
        };
      }>().data;
    }

    it('THEN it counts the library and lists the categories in the order they are drawn', async () => {
      const props = await addCategory('Environment Props');
      const bosses = await addCategory('World Bosses');
      await addAsset(props, 'Ruined watchtower');
      await addAsset(props, 'Harbour crane');
      await addAsset(bosses, 'Tidewrought Leviathan');

      const view = await workspace();

      expect(view.assetCount).toBe(3);
      expect(view.categories).toEqual([
        { id: props, depth: 0, name: 'Environment Props', color: '#adadad', count: 2 },
        { id: bosses, depth: 0, name: 'World Bosses', color: '#adadad', count: 1 },
      ]);
    });

    it('THEN a nested library is listed as the tree it is, and nothing is left out', async () => {
      const blocks = await addCategory('Blocks');
      const tests = await addCategoryInside(blocks, 'Tests');
      await addCategoryInside(tests, 'Stone');
      await addCategoryInside(blocks, 'Textures');
      await addCategory('Audio');

      await addAsset(tests, 'Bench');

      const view = await workspace();

      expect(view.categories.map((each) => [each.name, each.depth, each.count])).toEqual([
        // Everything under it, so the nav and the library agree about a heading.
        ['Blocks', 0, 1],
        ['Tests', 1, 1],
        ['Stone', 2, 0],
        ['Textures', 1, 0],
        // A root made after a branch is still a root, and still listed.
        ['Audio', 0, 0],
      ]);
    });

    it('THEN an empty category is still a line in the tree', async () => {
      await addCategory('Environment Props');

      // It is a place to put something, and a nav that hid it would be a nav
      // that hid the thing somebody just made.
      expect((await workspace()).categories).toMatchObject([
        { name: 'Environment Props', count: 0 },
      ]);
    });

    it('THEN the card badge counts what is open rather than what was ever made', async () => {
      const cardId = await addCard('Retopologise the watchtower');

      expect((await workspace()).openCardCount).toBe(1);

      await testDatabase.database
        .updateTable('card')
        .set({ closedAt: new Date() })
        .where('id', '=', cardId)
        .execute();

      // A badge counting finished work would only ever grow.
      expect((await workspace()).openCardCount).toBe(0);
    });

    it('THEN a project this caller cannot reach is refused', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/projects.workspace?slug=nothing-here',
        cookies: { lpm_session: ownerCookie },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN the dashboard is read', () => {
    async function dashboard(): Promise<ProjectDashboardView> {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/projects.dashboard?slug=saltmarsh',
        cookies: { lpm_session: ownerCookie },
      });

      return response.json<{ data: ProjectDashboardView }>().data;
    }

    it('THEN a project with nothing in it answers with zeros rather than refusing', async () => {
      const view = await dashboard();

      // A new project is a normal state. A dashboard that errored on one would
      // be a dashboard nobody sees until a week in.
      expect(view.work.openCount).toBe(0);
      expect(view.pipeline.total).toBe(0);
      expect(view.budget.estimatedMinor).toBe(0);
    });

    it('THEN every stage of the pipeline is named, including the empty ones', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (await addAsset(props, 'Ruined watchtower')).json<{ id: string }>().id;

      await command('assets.updateAsset', { assetId, status: 'review' });

      // A pipeline drawn from only what is populated changes shape as it fills,
      // and the gaps are half of what the shape says.
      expect((await dashboard()).pipeline.byStatus).toEqual({
        concept: 0,
        wip: 0,
        review: 1,
        approved: 0,
        final: 0,
      });
    });

    it('THEN work counts what is open, and blocked and overdue among it', async () => {
      const open = await addCard('Retopologise the watchtower');
      const done = await addCard('Second pass on the harbour');

      await testDatabase.database
        .updateTable('card')
        .set({ closedAt: new Date(), points: 5 })
        .where('id', '=', done)
        .execute();

      await testDatabase.database
        .updateTable('card')
        .set({ blocked: true, points: 3, dueOn: '2020-01-01' })
        .where('id', '=', open)
        .execute();

      const view = await dashboard();

      expect(view.work).toMatchObject({
        openCount: 1,
        closedCount: 1,
        blockedCount: 1,
        overdueCount: 1,
        pointsClosed: 5,
        pointsTotal: 8,
      });
    });

    it('THEN a card that was late but is finished is history rather than a problem', async () => {
      const cardId = await addCard('Retopologise the watchtower');

      await testDatabase.database
        .updateTable('card')
        .set({ closedAt: new Date(), dueOn: '2020-01-01', blocked: true })
        .where('id', '=', cardId)
        .execute();

      const view = await dashboard();

      expect(view.work.overdueCount).toBe(0);
      expect(view.work.blockedCount).toBe(0);
    });

    it('THEN what is approved is counted as committed, because it will not go down', async () => {
      const props = await addCategory('Environment Props');
      const estimated = (
        await addAsset(props, 'Ruined watchtower', { estimatedCostMinor: 240_000 })
      ).json<{ id: string }>().id;
      const approved = (
        await addAsset(props, 'Harbour crane', { estimatedCostMinor: 100_000 })
      ).json<{ id: string }>().id;

      await command('assets.updateAsset', { assetId: approved, status: 'approved' });

      const view = await dashboard();

      expect(view.budget.estimatedMinor).toBe(340_000);
      expect(view.budget.committedMinor).toBe(100_000);
      expect(estimated).toBeDefined();
    });

    it('THEN an asset nobody is assigned to is counted, since that is the real bottleneck', async () => {
      const props = await addCategory('Environment Props');
      await addAsset(props, 'Ruined watchtower');

      expect((await dashboard()).pipeline.unassignedCount).toBe(1);
    });

    it('THEN a project this caller cannot reach is refused', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/projects.dashboard?slug=nothing-here',
        cookies: { lpm_session: ownerCookie },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN the budget is read', () => {
    async function budget(): Promise<ProjectBudgetView> {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/projects.budget?slug=saltmarsh',
        cookies: { lpm_session: ownerCookie },
      });

      return response.json<{ data: ProjectBudgetView }>().data;
    }

    it('THEN a project with an empty library still answers with its own figures', async () => {
      // A studio that has set a budget and not filed anything yet is a normal
      // state, and a screen that errored on it is one nobody sees until later.
      const view = await budget();

      expect(view.categories).toEqual([]);
      expect(view.totals.estimatedMinor).toBe(0);
      expect(view.project.slug).toBe('saltmarsh');
    });

    it('THEN a category is the sum of what is filed under it', async () => {
      const props = await addCategory('Environment Props');

      await addAsset(props, 'Ruined watchtower', { estimatedCostMinor: 240_000 });
      await addAsset(props, 'Harbour crane', { estimatedCostMinor: 100_000 });

      const [category] = (await budget()).categories;

      expect(category).toMatchObject({
        name: 'Environment Props',
        assetCount: 2,
        estimatedMinor: 340_000,
        committedMinor: 0,
      });
    });

    it('THEN what is approved is committed, because it will not go down', async () => {
      const props = await addCategory('Environment Props');
      const assetId = (
        await addAsset(props, 'Harbour crane', { estimatedCostMinor: 100_000 })
      ).json<{ id: string }>().id;

      await addAsset(props, 'Ruined watchtower', { estimatedCostMinor: 240_000 });
      await command('assets.updateAsset', { assetId, status: 'approved' });

      expect((await budget()).totals).toMatchObject({
        estimatedMinor: 340_000,
        committedMinor: 100_000,
      });
    });

    it('THEN an asset with no cost is counted as missing rather than as nought', async () => {
      const props = await addCategory('Environment Props');

      await addAsset(props, 'Ruined watchtower', { estimatedCostMinor: 240_000 });
      await addAsset(props, 'Harbour crane');

      const view = await budget();

      // The part the total is missing, which is what a budget is usually wrong
      // by — a zero would report it as costed and free.
      expect(view.totals).toMatchObject({ assetCount: 2, unestimatedCount: 1 });
      expect(view.categories[0]?.unestimatedCount).toBe(1);
    });

    it('THEN a category nobody has budgeted says so rather than saying nothing', async () => {
      const props = await addCategory('Environment Props');
      await addAsset(props, 'Ruined watchtower', { estimatedCostMinor: 240_000 });

      const view = await budget();

      expect(view.categories[0]?.budgetMinor).toBeNull();
      expect(view.totals.allocatedMinor).toBe(0);
    });

    it('THEN what the categories hold between them is added up separately', async () => {
      const props = await addCategory('Environment Props', 500_000);
      const bosses = await addCategory('World Bosses', 800_000);

      await addAsset(props, 'Ruined watchtower', { estimatedCostMinor: 240_000 });
      await addAsset(bosses, 'Tidecaller', { estimatedCostMinor: 900_000 });

      const view = await budget();

      // What was set aside need not match the project's own figure, and the
      // screen shows both rather than pretending one of them is the truth.
      expect(view.totals.allocatedMinor).toBe(1_300_000);
      expect(view.totals.estimatedMinor).toBe(1_140_000);
    });

    it('THEN the totals are the sum of the rows, so the two cannot disagree', async () => {
      const props = await addCategory('Environment Props', 500_000);
      const bosses = await addCategory('World Bosses');

      await addAsset(props, 'Ruined watchtower', { estimatedCostMinor: 240_000 });
      await addAsset(bosses, 'Tidecaller', { estimatedCostMinor: 900_000 });
      await addAsset(bosses, 'Drowned herald');

      const view = await budget();
      const rows = view.categories;

      expect(view.totals.estimatedMinor).toBe(
        rows.reduce((total, row) => total + row.estimatedMinor, 0),
      );
      expect(view.totals.assetCount).toBe(rows.reduce((total, row) => total + row.assetCount, 0));
    });

    it('THEN a project this caller cannot reach is refused', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/projects.budget?slug=nothing-here',
        cookies: { lpm_session: ownerCookie },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN somebody without a session asks', () => {
    it('THEN they are refused', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/assets.library?slug=saltmarsh',
      });

      expect(response.statusCode).toBe(401);
    });

    it('THEN a project they cannot see reads as one that does not exist', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/assets.library?slug=not-a-project',
        cookies: { lpm_session: ownerCookie },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
