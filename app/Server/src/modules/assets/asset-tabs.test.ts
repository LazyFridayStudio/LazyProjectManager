import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import {
  MAXIMUM_TABS_PER_ASSET,
  type AssetDetailView,
  type AssetLibraryView,
  type AssetTemplateDefinition,
  type AssetTemplatesView,
  type DeletedThingsView,
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
const MEMBER_EMAIL = 'mira@northwind.test';
const NOWHERE = '018f0000-0000-7000-8000-000000000000';

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
  return `018fbbbb-0000-7000-8000-${String(commandCounter).padStart(12, '0')}`;
}

function readSessionCookie(cookies: readonly { name: string; value: string }[]): string {
  const cookie = cookies.find((candidate) => candidate.name === 'lpm_session');

  if (cookie === undefined) {
    throw new Error('Expected a session cookie to have been set.');
  }

  return cookie.value;
}

/** A creature's tabs, as a studio might keep them. */
const CREATURE: AssetTemplateDefinition = {
  tabs: [
    { title: 'Mesh', blocks: [{ kind: 'checklist', items: ['Blockout', 'Retopo'] }] },
    { title: 'Rig', blocks: [{ kind: 'notes', body: 'Humanoid skeleton.' }, { kind: 'files' }] },
    { title: 'Animation', blocks: [{ kind: 'work' }] },
  ],
};

describe('GIVEN an asset worked in tabs', () => {
  const redis = createStubRedis();

  let testDatabase: TestDatabase;
  let server: FastifyInstance;
  let passwordHash: string;
  let ownerCookie: string;
  let projectId: string;
  let categoryId: string;

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
    categoryId = await idOf(
      command('assets.createCategory', { projectId, name: 'Creatures', color: '#adadad' }),
    );
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
    cookie: string = ownerCookie,
  ): Promise<Awaited<ReturnType<typeof server.inject>>> {
    return server.inject({
      method: 'POST',
      url: `/api/c/${name}`,
      payload: { commandId: nextCommandId(), ...body },
      cookies: { lpm_session: cookie },
    });
  }

  async function query<TView>(path: string, cookie: string = ownerCookie): Promise<TView> {
    const response = await server.inject({
      method: 'GET',
      url: `/api/q/${path}`,
      cookies: { lpm_session: cookie },
    });

    return response.json<{ data: TView }>().data;
  }

  async function idOf(sent: Promise<Awaited<ReturnType<typeof server.inject>>>): Promise<string> {
    return (await sent).json<{ id: string }>().id;
  }

  async function addAsset(name = 'Tank', extra: Record<string, unknown> = {}): Promise<string> {
    return idOf(command('assets.createAsset', { projectId, categoryId, name, ...extra }));
  }

  async function addTab(assetId: string, title: string): Promise<string> {
    return idOf(command('assets.addTab', { assetId, title }));
  }

  async function addBlock(
    assetTabId: string,
    kind: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    return idOf(command('assets.addBlock', { assetTabId, kind, ...extra }));
  }

  async function detail(assetId: string): Promise<AssetDetailView> {
    return query<AssetDetailView>(`assets.detail?assetId=${assetId}`);
  }

  async function titles(assetId: string): Promise<string[]> {
    return (await detail(assetId)).tabs.map((tab) => tab.title);
  }

  async function templates(cookie: string = ownerCookie): Promise<AssetTemplatesView> {
    return query<AssetTemplatesView>(`assets.templates?projectId=${projectId}`, cookie);
  }

  async function createTemplate(
    name: string,
    definition: AssetTemplateDefinition = CREATURE,
  ): Promise<string> {
    return idOf(command('assets.createTemplate', { projectId, name, definition }));
  }

  /** Somebody on the project at the role most of a studio has. */
  async function seedMember(): Promise<{ userId: string; cookie: string }> {
    const { accountId } = await testDatabase.database
      .selectFrom('membership')
      .select('accountId')
      .executeTakeFirstOrThrow();

    const user = await testDatabase.database
      .insertInto('appUser')
      .values({
        email: MEMBER_EMAIL,
        passwordHash,
        displayName: 'Mira Kaur',
        initials: 'MK',
        status: 'active',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await testDatabase.database
      .insertInto('membership')
      .values({ accountId, userId: user.id, role: 'member' })
      .execute();

    await command('projects.addMember', { projectId, userId: user.id });

    return { userId: user.id, cookie: await signIn(MEMBER_EMAIL) };
  }

  describe('WHEN tabs are added', () => {
    it('THEN they come back in the order somebody put them, not alphabetical', async () => {
      const assetId = await addAsset();

      for (const title of ['Mesh', 'UVs', 'Texture', 'Rig']) {
        await addTab(assetId, title);
      }

      expect(await titles(assetId)).toEqual(['Mesh', 'UVs', 'Texture', 'Rig']);
    });

    it('THEN a new tab is not done, has nobody on it, and is built from nothing yet', async () => {
      const assetId = await addAsset();

      await addTab(assetId, 'Mesh');

      expect((await detail(assetId)).tabs[0]).toMatchObject({
        done: false,
        assignee: null,
        dueOn: null,
        blocks: [],
      });
    });

    it('THEN the same add sent twice adds one tab, not two', async () => {
      const assetId = await addAsset();
      const commandId = nextCommandId();

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await server.inject({
          method: 'POST',
          url: '/api/c/assets.addTab',
          payload: { commandId, assetId, title: 'Mesh' },
          cookies: { lpm_session: ownerCookie },
        });
      }

      expect(await titles(assetId)).toEqual(['Mesh']);
    });

    it('THEN an asset that is not there is refused as one', async () => {
      expect((await command('assets.addTab', { assetId: NOWHERE, title: 'Mesh' })).statusCode).toBe(
        404,
      );
    });

    it('THEN one past the most an asset may have is refused', async () => {
      const assetId = await addAsset();

      for (let index = 0; index < MAXIMUM_TABS_PER_ASSET; index += 1) {
        await addTab(assetId, `Tab ${String(index)}`);
      }

      const refused = await command('assets.addTab', { assetId, title: 'One more' });

      expect(refused.statusCode).toBe(422);
      expect((await detail(assetId)).tabs).toHaveLength(MAXIMUM_TABS_PER_ASSET);
    });
  });

  describe('WHEN a tab is changed', () => {
    it('THEN it can be ticked off, renamed and dated without touching the others', async () => {
      const assetId = await addAsset();
      const mesh = await addTab(assetId, 'Mesh');

      await addTab(assetId, 'Rig');
      await command('assets.updateTab', { assetTabId: mesh, done: true });
      await command('assets.updateTab', { assetTabId: mesh, title: 'Mesh & UVs' });
      await command('assets.updateTab', { assetTabId: mesh, dueOn: '2026-11-01' });

      expect((await detail(assetId)).tabs).toMatchObject([
        { title: 'Mesh & UVs', done: true, dueOn: '2026-11-01' },
        { title: 'Rig', done: false, dueOn: null },
      ]);
    });

    it('THEN it can be given to somebody on the project, and taken off them', async () => {
      const assetId = await addAsset();
      const rig = await addTab(assetId, 'Rig');
      const { userId } = await seedMember();

      await command('assets.updateTab', { assetTabId: rig, assigneeId: userId });

      expect((await detail(assetId)).tabs[0]?.assignee).toMatchObject({
        userId,
        displayName: 'Mira Kaur',
      });

      await command('assets.updateTab', { assetTabId: rig, assigneeId: null });

      expect((await detail(assetId)).tabs[0]?.assignee).toBeNull();
    });

    it('THEN somebody not on the project cannot be given it', async () => {
      const assetId = await addAsset();
      const rig = await addTab(assetId, 'Rig');
      const { userId } = await seedMember();

      await testDatabase.database
        .deleteFrom('projectMember')
        .where('userId', '=', userId)
        .execute();

      expect(
        (await command('assets.updateTab', { assetTabId: rig, assigneeId: userId })).statusCode,
      ).toBe(422);
    });

    it('THEN a change that says nothing is refused rather than silently doing nothing', async () => {
      const assetId = await addAsset();
      const mesh = await addTab(assetId, 'Mesh');

      expect((await command('assets.updateTab', { assetTabId: mesh })).statusCode).toBe(422);
    });

    it('THEN a tab that is not there is refused as the asset not being there', async () => {
      expect(
        (await command('assets.updateTab', { assetTabId: NOWHERE, done: true })).statusCode,
      ).toBe(404);
    });

    it('THEN it can be moved along the row', async () => {
      const assetId = await addAsset();
      const mesh = await addTab(assetId, 'Mesh');
      const uvs = await addTab(assetId, 'UVs');
      const rig = await addTab(assetId, 'Rig');

      await command('assets.moveTab', { assetTabId: rig, beforeTabId: mesh });
      await command('assets.moveTab', { assetTabId: mesh, afterTabId: uvs });

      expect(await titles(assetId)).toEqual(['Rig', 'UVs', 'Mesh']);
      expect(rig).toBeDefined();
    });

    it('THEN the tile counts them, so a library says how far along things are', async () => {
      const assetId = await addAsset();
      const mesh = await addTab(assetId, 'Mesh');

      await addTab(assetId, 'UVs');
      await addTab(assetId, 'Rig');
      await command('assets.updateTab', { assetTabId: mesh, done: true });

      const view = await query<AssetLibraryView>('assets.library?slug=saltmarsh');

      expect(view.categories[0]?.assets[0]).toMatchObject({ tabCount: 3, tabsDone: 1 });
    });
  });

  describe('WHEN a tab is built from blocks', () => {
    it('THEN the blocks come back in order, a notes block with what it says', async () => {
      const assetId = await addAsset();
      const rig = await addTab(assetId, 'Rig');

      await addBlock(rig, 'notes', { body: 'Humanoid, with a tail.' });
      await addBlock(rig, 'checklist');
      await addBlock(rig, 'files');
      await addBlock(rig, 'work');

      expect((await detail(assetId)).tabs[0]?.blocks).toMatchObject([
        { kind: 'notes', body: 'Humanoid, with a tail.', items: [] },
        { kind: 'checklist', body: null, items: [] },
        { kind: 'files', body: null },
        { kind: 'work', body: null },
      ]);
    });

    it('THEN only a notes block keeps text, whatever arrives with another', async () => {
      const assetId = await addAsset();
      const rig = await addTab(assetId, 'Rig');

      await addBlock(rig, 'checklist', { body: 'Ignored' });

      expect((await detail(assetId)).tabs[0]?.blocks[0]?.body).toBeNull();
    });

    it('THEN a notes block can be rewritten, and nothing else can', async () => {
      const assetId = await addAsset();
      const rig = await addTab(assetId, 'Rig');
      const notes = await addBlock(rig, 'notes');
      const checklist = await addBlock(rig, 'checklist');

      await command('assets.updateBlock', { blockId: notes, body: 'Quadruped.' });

      expect((await detail(assetId)).tabs[0]?.blocks[0]?.body).toBe('Quadruped.');
      expect(
        (await command('assets.updateBlock', { blockId: checklist, body: 'x' })).statusCode,
      ).toBe(422);
    });

    it('THEN a tab has one files block and one work block at most', async () => {
      const assetId = await addAsset();
      const rig = await addTab(assetId, 'Rig');

      await addBlock(rig, 'files');
      await addBlock(rig, 'work');

      const files = await command('assets.addBlock', { assetTabId: rig, kind: 'files' });
      const work = await command('assets.addBlock', { assetTabId: rig, kind: 'work' });

      // A second would show the same files twice.
      expect(files.statusCode).toBe(422);
      expect(files.json<{ message: string }>().message).toContain('files block');
      expect(work.statusCode).toBe(422);
      // Notes and checklists are what somebody wrote, and there can be several.
      expect(
        (await command('assets.addBlock', { assetTabId: rig, kind: 'notes' })).statusCode,
      ).toBe(200);
      expect(
        (await command('assets.addBlock', { assetTabId: rig, kind: 'notes' })).statusCode,
      ).toBe(200);
    });

    it('THEN a block can be moved up its tab, and taken off it', async () => {
      const assetId = await addAsset();
      const rig = await addTab(assetId, 'Rig');
      const notes = await addBlock(rig, 'notes');
      const checklist = await addBlock(rig, 'checklist');
      const files = await addBlock(rig, 'files');

      await command('assets.moveBlock', { blockId: files, beforeBlockId: notes });

      expect((await detail(assetId)).tabs[0]?.blocks.map((block) => block.kind)).toEqual([
        'files',
        'notes',
        'checklist',
      ]);

      await command('assets.moveBlock', { blockId: files, afterBlockId: checklist });
      await command('assets.removeBlock', { blockId: notes });

      expect((await detail(assetId)).tabs[0]?.blocks.map((block) => block.kind)).toEqual([
        'checklist',
        'files',
      ]);
    });

    it('THEN a block that is not there is refused as the asset not being there', async () => {
      expect((await command('assets.removeBlock', { blockId: NOWHERE })).statusCode).toBe(404);
    });
  });

  describe('WHEN a checklist block is filled in', () => {
    async function checklistOn(): Promise<{ assetId: string; blockId: string }> {
      const assetId = await addAsset();
      const tab = await addTab(assetId, 'Animation');

      return { assetId, blockId: await addBlock(tab, 'checklist') };
    }

    async function items(assetId: string): Promise<{ title: string; done: boolean }[]> {
      return (await detail(assetId)).tabs[0]?.blocks[0]?.items ?? [];
    }

    it('THEN its lines come back in the order they were added, unticked', async () => {
      const { assetId, blockId } = await checklistOn();

      for (const title of ['Idle', 'Walk', 'Roar']) {
        await command('assets.addChecklistItem', { blockId, title });
      }

      expect(await items(assetId)).toMatchObject([
        { title: 'Idle', done: false },
        { title: 'Walk', done: false },
        { title: 'Roar', done: false },
      ]);
    });

    it('THEN a line can be ticked, renamed and taken off', async () => {
      const { assetId, blockId } = await checklistOn();
      const idle = await idOf(command('assets.addChecklistItem', { blockId, title: 'Idle' }));
      const walk = await idOf(command('assets.addChecklistItem', { blockId, title: 'Walk' }));

      await command('assets.updateChecklistItem', { itemId: idle, done: true });
      await command('assets.updateChecklistItem', { itemId: idle, title: 'Idle loop' });
      await command('assets.removeChecklistItem', { itemId: walk });

      expect(await items(assetId)).toMatchObject([{ title: 'Idle loop', done: true }]);
    });

    it('THEN a change that says nothing is refused', async () => {
      const { blockId } = await checklistOn();
      const idle = await idOf(command('assets.addChecklistItem', { blockId, title: 'Idle' }));

      expect((await command('assets.updateChecklistItem', { itemId: idle })).statusCode).toBe(422);
    });

    it('THEN only a checklist takes lines', async () => {
      const assetId = await addAsset();
      const tab = await addTab(assetId, 'Rig');
      const notes = await addBlock(tab, 'notes');

      expect(
        (await command('assets.addChecklistItem', { blockId: notes, title: 'Idle' })).statusCode,
      ).toBe(422);
    });

    it('THEN a line that is not there is refused as the asset not being there', async () => {
      expect(
        (await command('assets.updateChecklistItem', { itemId: NOWHERE, done: true })).statusCode,
      ).toBe(404);
    });

    it('THEN taking the block off takes its lines with it', async () => {
      const { assetId, blockId } = await checklistOn();

      await command('assets.addChecklistItem', { blockId, title: 'Idle' });
      await command('assets.removeBlock', { blockId });

      const left = await testDatabase.database
        .selectFrom('assetTabChecklistItem')
        .select('id')
        .where('assetId', '=', assetId)
        .execute();

      expect(left).toEqual([]);
    });
  });

  describe('WHEN files and hours say which tab they were for', () => {
    it('THEN a linked file names its tab, and the asset still lists it', async () => {
      const assetId = await addAsset();
      const rig = await addTab(assetId, 'Rig');

      await command('assets.linkFile', {
        assetId,
        label: 'tank_rig.blend',
        url: 'https://depot.example/tank_rig.blend',
        assetTabId: rig,
      });
      await command('assets.linkFile', {
        assetId,
        label: 'tank_brief.pdf',
        url: 'https://depot.example/tank_brief.pdf',
      });

      expect((await detail(assetId)).files).toMatchObject([
        { label: 'tank_rig.blend', tabId: rig },
        { label: 'tank_brief.pdf', tabId: null },
      ]);
    });

    it('THEN a tab of another asset is refused', async () => {
      const tank = await addAsset('Tank');
      const runner = await addAsset('Runner');
      const runnersRig = await addTab(runner, 'Rig');

      const refused = await command('assets.linkFile', {
        assetId: tank,
        label: 'tank_rig.blend',
        url: 'https://depot.example/tank_rig.blend',
        assetTabId: runnersRig,
      });

      expect(refused.statusCode).toBe(404);
    });

    it('THEN hours name their tab, and the asset adds all of them up', async () => {
      const assetId = await addAsset();
      const rig = await addTab(assetId, 'Rig');

      await command('work.log', { assetId, assetTabId: rig, minutes: 120, workedOn: '2026-10-01' });
      await command('work.log', { assetId, minutes: 60, workedOn: '2026-10-02' });

      const { work } = await detail(assetId);

      expect(work.loggedMinutes).toBe(180);
      expect(work.entries.map((entry) => entry.assetTabId).sort()).toEqual([rig, null].sort());
    });

    it('THEN hours on a card cannot name an asset tab', async () => {
      const assetId = await addAsset();
      const rig = await addTab(assetId, 'Rig');
      const list = await testDatabase.database
        .selectFrom('list')
        .select('id')
        .orderBy('position')
        .executeTakeFirstOrThrow();
      const cardId = await idOf(
        command('board.createCard', { projectId, listId: list.id, title: 'Rig it', type: 'art' }),
      );

      const refused = await command('work.log', {
        cardId,
        assetTabId: rig,
        minutes: 60,
        workedOn: '2026-10-01',
      });

      expect(refused.statusCode).toBe(422);
    });
  });

  describe('WHEN a tab is deleted', () => {
    async function binnedTab(): Promise<DeletedThingsView['things'][number] | undefined> {
      return (await query<DeletedThingsView>('recovery.deletedThings')).things.find(
        (thing) => thing.what === 'Asset tab',
      );
    }

    it('THEN it waits in the bin, and the files and hours that named it stay on the asset', async () => {
      const assetId = await addAsset();
      const rig = await addTab(assetId, 'Rig');

      await command('assets.linkFile', {
        assetId,
        label: 'tank_rig.blend',
        url: 'https://depot.example/tank_rig.blend',
        assetTabId: rig,
      });
      await command('work.log', { assetId, assetTabId: rig, minutes: 90, workedOn: '2026-10-01' });
      await command('assets.deleteTab', { assetTabId: rig });

      const view = await detail(assetId);

      expect(view.tabs).toEqual([]);
      expect(view.files).toMatchObject([{ label: 'tank_rig.blend', tabId: null }]);
      expect(view.work.entries).toMatchObject([{ minutes: 90, assetTabId: null }]);
      expect(await binnedTab()).toMatchObject({ name: 'Rig', about: 'SLTM-AST-1' });
    });

    it('THEN putting it back brings its blocks and lines, and the tags on its files and hours', async () => {
      const assetId = await addAsset();
      const rig = await addTab(assetId, 'Rig');
      const checklist = await addBlock(rig, 'checklist');

      await command('assets.addChecklistItem', { blockId: checklist, title: 'Weights' });
      await command('assets.linkFile', {
        assetId,
        label: 'tank_rig.blend',
        url: 'https://depot.example/tank_rig.blend',
        assetTabId: rig,
      });
      await command('work.log', { assetId, assetTabId: rig, minutes: 90, workedOn: '2026-10-01' });
      await command('assets.deleteTab', { assetTabId: rig });

      const restored = await command('recovery.restore', {
        deletedThingId: (await binnedTab())?.id,
      });
      const view = await detail(assetId);

      expect(restored.statusCode).toBe(200);
      expect(view.tabs).toMatchObject([
        { id: rig, title: 'Rig', blocks: [{ kind: 'checklist', items: [{ title: 'Weights' }] }] },
      ]);
      expect(view.files).toMatchObject([{ tabId: rig }]);
      expect(view.work.entries).toMatchObject([{ assetTabId: rig }]);
    });

    it('THEN a tab whose asset was deleted since is refused in words', async () => {
      const assetId = await addAsset();
      const rig = await addTab(assetId, 'Rig');

      await command('assets.deleteTab', { assetTabId: rig });
      await command('assets.deleteAsset', { assetId });

      const refused = await command('recovery.restore', {
        deletedThingId: (await binnedTab())?.id,
      });

      expect(refused.statusCode).toBe(422);
      expect(refused.json<{ message: string }>().message).toContain('Put the asset back first');
    });

    it('THEN deleting the asset takes its tabs to the bin with it, and brings them back', async () => {
      const assetId = await addAsset();
      const rig = await addTab(assetId, 'Rig');

      await addBlock(rig, 'notes', { body: 'Humanoid.' });
      await command('assets.deleteAsset', { assetId });

      const asset = (await query<DeletedThingsView>('recovery.deletedThings')).things.find(
        (thing) => thing.what === 'Asset',
      );

      await command('recovery.restore', { deletedThingId: asset?.id });

      expect((await detail(assetId)).tabs).toMatchObject([
        { title: 'Rig', blocks: [{ kind: 'notes', body: 'Humanoid.' }] },
      ]);
    });
  });

  describe('WHEN the project keeps templates', () => {
    it('THEN they are listed by name, with what each would make', async () => {
      await createTemplate('Static prop', { tabs: [{ title: 'Mesh', blocks: [] }] });
      await createTemplate('Creature');

      const view = await templates();

      expect(view.canManage).toBe(true);
      expect(view.templates.map((template) => template.name)).toEqual(['Creature', 'Static prop']);
      expect(view.templates[0]?.definition).toEqual(CREATURE);
    });

    it('THEN two with one name are refused', async () => {
      await createTemplate('Creature');

      const clash = await command('assets.createTemplate', {
        projectId,
        name: 'Creature',
        definition: CREATURE,
      });

      expect(clash.statusCode).toBe(409);
    });

    it('THEN one can be renamed, refilled and deleted', async () => {
      const templateId = await createTemplate('Creature');

      await command('assets.updateTemplate', { templateId, name: 'Rigged creature' });
      await command('assets.updateTemplate', {
        templateId,
        definition: { tabs: [{ title: 'Mesh', blocks: [] }] },
      });

      expect((await templates()).templates).toMatchObject([
        { name: 'Rigged creature', definition: { tabs: [{ title: 'Mesh' }] } },
      ]);

      await command('assets.deleteTemplate', { templateId });

      expect((await templates()).templates).toEqual([]);
    });

    it('THEN renaming one onto another name is refused', async () => {
      await createTemplate('Creature');
      const prop = await createTemplate('Prop');

      expect(
        (await command('assets.updateTemplate', { templateId: prop, name: 'Creature' })).statusCode,
      ).toBe(409);
    });

    it('THEN a template that is not there is refused', async () => {
      expect((await command('assets.deleteTemplate', { templateId: NOWHERE })).statusCode).toBe(
        404,
      );
    });

    it('THEN a member may start an asset from one, and may not keep them', async () => {
      const templateId = await createTemplate('Creature');
      const assetId = await addAsset();
      const { cookie } = await seedMember();

      const kept = await command(
        'assets.createTemplate',
        { projectId, name: 'Mine', definition: CREATURE },
        cookie,
      );
      const applied = await command('assets.applyTemplate', { assetId, templateId }, cookie);

      expect(kept.statusCode).toBe(403);
      expect(applied.statusCode).toBe(200);
      expect((await templates(cookie)).canManage).toBe(false);
    });
  });

  describe('WHEN a template is applied to an asset', () => {
    it('THEN its tabs go after the ones the asset has, with their blocks and unticked lines', async () => {
      const templateId = await createTemplate('Creature');
      const assetId = await addAsset();

      await addTab(assetId, 'Concept');
      await command('assets.applyTemplate', { assetId, templateId });

      const view = await detail(assetId);

      expect(view.tabs.map((tab) => tab.title)).toEqual(['Concept', 'Mesh', 'Rig', 'Animation']);
      expect(view.tabs[1]?.blocks[0]?.items).toMatchObject([
        { title: 'Blockout', done: false },
        { title: 'Retopo', done: false },
      ]);
      expect(view.tabs[2]?.blocks).toMatchObject([
        { kind: 'notes', body: 'Humanoid skeleton.' },
        { kind: 'files' },
      ]);
    });

    it('THEN one from another project is refused', async () => {
      const elsewhere = await idOf(command('projects.create', { name: 'Kiln', code: 'KILN' }));
      const templateId = await idOf(
        command('assets.createTemplate', {
          projectId: elsewhere,
          name: 'Creature',
          definition: CREATURE,
        }),
      );
      const assetId = await addAsset();

      expect((await command('assets.applyTemplate', { assetId, templateId })).statusCode).toBe(404);
    });

    it('THEN one that would take the asset past the most tabs is refused whole', async () => {
      const templateId = await createTemplate('Creature');
      const assetId = await addAsset();

      for (let index = 0; index < MAXIMUM_TABS_PER_ASSET - 1; index += 1) {
        await addTab(assetId, `Tab ${String(index)}`);
      }

      expect((await command('assets.applyTemplate', { assetId, templateId })).statusCode).toBe(422);
      // Nothing half applied.
      expect((await detail(assetId)).tabs).toHaveLength(MAXIMUM_TABS_PER_ASSET - 1);
    });
  });

  describe('WHEN a category offers a template', () => {
    it('THEN an asset filed there starts with its tabs', async () => {
      const templateId = await createTemplate('Creature');

      await command('assets.updateCategory', { categoryId, defaultTemplateId: templateId });

      expect(await titles(await addAsset())).toEqual(['Mesh', 'Rig', 'Animation']);

      const view = await query<AssetLibraryView>('assets.library?slug=saltmarsh');

      expect(view.categories[0]?.defaultTemplateId).toBe(templateId);
    });

    it('THEN somebody adding the one that is different can say none', async () => {
      const templateId = await createTemplate('Creature');

      await command('assets.updateCategory', { categoryId, defaultTemplateId: templateId });

      expect(await titles(await addAsset('Swarm', { templateId: null }))).toEqual([]);
    });

    it('THEN another template can be named instead', async () => {
      const creature = await createTemplate('Creature');
      const prop = await createTemplate('Prop', { tabs: [{ title: 'Model', blocks: [] }] });

      await command('assets.updateCategory', { categoryId, defaultTemplateId: creature });

      expect(await titles(await addAsset('Crate', { templateId: prop }))).toEqual(['Model']);
    });

    it('THEN a template of another project cannot be offered', async () => {
      const elsewhere = await idOf(command('projects.create', { name: 'Kiln', code: 'KILN' }));
      const templateId = await idOf(
        command('assets.createTemplate', {
          projectId: elsewhere,
          name: 'Creature',
          definition: CREATURE,
        }),
      );

      expect(
        (await command('assets.updateCategory', { categoryId, defaultTemplateId: templateId }))
          .statusCode,
      ).toBe(404);
    });

    it('THEN deleting the template leaves the category offering nothing', async () => {
      const templateId = await createTemplate('Creature');

      await command('assets.updateCategory', { categoryId, defaultTemplateId: templateId });
      await command('assets.deleteTemplate', { templateId });

      expect(await titles(await addAsset())).toEqual([]);
    });
  });
});
