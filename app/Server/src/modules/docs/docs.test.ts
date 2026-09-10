import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import type { DesignDocView } from '@lpm/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createStubObjectStore } from '../../storage/index.js';
import { createStubRedis } from '../../testing/index.js';
import { createServer } from '../../server/create-server.js';
import { readEnvironment } from '../../server/environment.js';
import { hashPassword } from '../identity/password-hasher.js';

const PASSWORD = 'correct-horse-battery';
const OWNER_EMAIL = 'jake@northwind.test';

/** Written this way because an escaped one keeps being eaten in transit. */
const NEWLINE = String.fromCharCode(10);

const testEnvironment = readEnvironment({
  NODE_ENV: 'test',
  BASE_URL: 'http://localhost:24571',
  DATABASE_URL: 'postgres://unused',
  REDIS_URL: 'redis://unused',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'unused',
  S3_ACCESS_KEY: 'unused',
  S3_SECRET_KEY: 'unused',
});

describe('GIVEN a project with a design document to write', () => {
  let testDatabase: TestDatabase;
  let server: FastifyInstance;
  let passwordHash: string;
  let ownerCookie: string;
  let projectId: string;
  let commandCount = 0;

  // The sign-in limiter counts in Redis and its counters outlive a test, so a
  // suite that signs in per test starts failing partway through without this.
  const redis = createStubRedis();

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    passwordHash = await hashPassword(PASSWORD);
    server = await createServer({
      database: testDatabase.database,
      redis,
      storage: createStubObjectStore(),
      environment: testEnvironment,
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

    const cookie = response.cookies.find((each) => each.name === 'lpm_session');

    return cookie?.value ?? '';
  }

  async function command(
    name: string,
    body: Record<string, unknown>,
  ): Promise<Awaited<ReturnType<typeof server.inject>>> {
    const options: InjectOptions = {
      method: 'POST',
      url: `/api/c/${name}`,
      payload: { commandId: nextCommandId(), ...body },
      cookies: { lpm_session: ownerCookie },
    };

    return server.inject(options);
  }

  async function doc(docId?: string): Promise<DesignDocView> {
    const response = await server.inject({
      method: 'GET',
      url: `/api/q/docs.designDoc?slug=saltmarsh${docId === undefined ? '' : `&docId=${docId}`}`,
      cookies: { lpm_session: ownerCookie },
    });

    return response.json<{ data: DesignDocView }>().data;
  }

  async function addDoc(title: string): Promise<string> {
    const response = await command('docs.createDoc', { projectId, title });

    return response.json<{ id: string }>().id;
  }

  async function write(
    docId: string,
    body: string,
  ): Promise<Awaited<ReturnType<typeof server.inject>>> {
    return command('docs.updateDoc', { docId, body });
  }

  describe('WHEN a project has no documents yet', () => {
    it('THEN it answers with an empty row of tabs rather than refusing', async () => {
      // What a studio writes down differs by studio, so a project starts
      // with none rather than with one nobody named.
      const view = await doc();

      expect(view.documents).toEqual([]);
      expect(view.document).toBeNull();
    });
  });

  describe('WHEN a project keeps several documents', () => {
    it('THEN they come back in the order they were made', async () => {
      await addDoc('Game design');
      await addDoc('Art direction');
      await addDoc('Audio bible');

      expect((await doc()).documents.map((each) => each.title)).toEqual([
        'Game design',
        'Art direction',
        'Audio bible',
      ]);
    });

    it('THEN the first is the one opened, which is what a link should show', async () => {
      await addDoc('Game design');
      await addDoc('Art direction');

      expect((await doc()).document?.title).toBe('Game design');
    });

    it('THEN asking for one by id opens that one', async () => {
      await addDoc('Game design');
      const audio = await addDoc('Audio bible');

      expect((await doc(audio)).document?.title).toBe('Audio bible');
    });

    it('THEN a document from another project falls back rather than erroring', async () => {
      await addDoc('Game design');

      const other = (await command('projects.create', { name: 'Kiln', code: 'KILN' })).json<{
        id: string;
      }>().id;
      const elsewhere = (
        await command('docs.createDoc', { projectId: other, title: 'Elsewhere' })
      ).json<{ id: string }>().id;

      // A stale tab is not a mistake worth a page of red.
      expect((await doc(elsewhere)).document?.title).toBe('Game design');
    });

    it('THEN each tab says how long its own document is', async () => {
      const design = await addDoc('Game design');
      await addDoc('Audio bible');
      await write(design, 'Four words are here.');

      const tabs = (await doc()).documents;

      expect(tabs[0]?.wordCount).toBe(4);
      expect(tabs[1]?.wordCount).toBe(0);
    });
  });

  describe('WHEN the documents are put in another order', () => {
    /** The row of tabs, as the screen draws it. */
    async function titles(): Promise<string[]> {
      return (await doc()).documents.map((each) => each.title);
    }

    it('THEN one moved to the front is at the front', async () => {
      const design = await addDoc('Game design');
      await addDoc('Audio bible');
      const pitch = await addDoc('One-page pitch');

      await command('docs.moveDoc', { docId: pitch, beforeDocId: design, afterDocId: null });

      expect(await titles()).toEqual(['One-page pitch', 'Game design', 'Audio bible']);
    });

    it('THEN one moved between two others is between them', async () => {
      const design = await addDoc('Game design');
      const audio = await addDoc('Audio bible');
      const pitch = await addDoc('One-page pitch');

      await command('docs.moveDoc', { docId: pitch, beforeDocId: audio, afterDocId: design });

      expect(await titles()).toEqual(['Game design', 'One-page pitch', 'Audio bible']);
    });

    it('THEN one moved to the end is at the end', async () => {
      const design = await addDoc('Game design');
      await addDoc('Audio bible');
      const pitch = await addDoc('One-page pitch');

      await command('docs.moveDoc', { docId: design, beforeDocId: null, afterDocId: pitch });

      expect(await titles()).toEqual(['Audio bible', 'One-page pitch', 'Game design']);
    });

    /*
     * The header says when the prose was last written and by whom, which is the
     * question a studio asks of a design document before it reads one. Dragging
     * a tab is not an answer to it.
     */
    it('THEN it does not count as having written the document', async () => {
      const design = await addDoc('Game design');
      const audio = await addDoc('Audio bible');

      await write(design, 'Four words are here.');

      const before = (await doc(design)).document?.updatedAt;

      await command('docs.moveDoc', { docId: design, beforeDocId: null, afterDocId: audio });

      expect((await doc(design)).document?.updatedAt).toBe(before);
    });

    it('THEN a document in another project is not moved by a project it is not in', async () => {
      await addDoc('Game design');

      const other = (await command('projects.create', { name: 'Kiln', code: 'KILN' })).json<{
        id: string;
      }>().id;
      const elsewhere = (
        await command('docs.createDoc', { projectId: other, title: 'Elsewhere' })
      ).json<{ id: string }>().id;

      // Named as a neighbour it could not possibly have. The move falls back to
      // the end of its own row rather than reaching across projects.
      const response = await command('docs.moveDoc', {
        docId: elsewhere,
        beforeDocId: null,
        afterDocId: null,
      });

      expect(response.statusCode).toBe(200);
      expect(await titles()).toEqual(['Game design']);
    });
  });

  describe('WHEN a document is written', () => {
    it('THEN the markdown comes back exactly as it was written', async () => {
      const design = await addDoc('Game design');
      const body = ['# Pillars', '', 'You are the **last** lamplighter.'].join(NEWLINE);

      await write(design, body);

      expect((await doc(design)).document?.body).toBe(body);
    });

    it('THEN writing one leaves the others alone', async () => {
      const design = await addDoc('Game design');
      const audio = await addDoc('Audio bible');

      await write(design, 'Only this one.');

      expect((await doc(audio)).document?.body).toBe('');
    });

    it('THEN emptying it is a thing somebody is allowed to do', async () => {
      const design = await addDoc('Game design');

      await write(design, 'Something.');
      await write(design, '');

      expect((await doc(design)).document?.body).toBe('');
    });

    it('THEN a document longer than anybody would write is refused', async () => {
      const design = await addDoc('Game design');

      expect((await write(design, 'x'.repeat(400_001))).statusCode).toBe(422);
    });
  });

  describe('WHEN a document is renamed or dropped', () => {
    it('THEN renaming it leaves what is written in it alone', async () => {
      const design = await addDoc('Game design');
      await write(design, 'Still here.');

      await command('docs.renameDoc', { docId: design, title: 'Game design v2' });

      const view = await doc(design);

      expect(view.document?.title).toBe('Game design v2');
      expect(view.document?.body).toBe('Still here.');
    });

    it('THEN deleting one leaves the rest of the row', async () => {
      const design = await addDoc('Game design');
      await addDoc('Audio bible');

      await command('docs.deleteDoc', { docId: design });

      expect((await doc()).documents.map((each) => each.title)).toEqual(['Audio bible']);
    });

    it('THEN deleting the last one leaves an empty row rather than an error', async () => {
      const design = await addDoc('Game design');

      await command('docs.deleteDoc', { docId: design });

      const view = await doc();

      expect(view.documents).toEqual([]);
      expect(view.document).toBeNull();
    });

    it('THEN a document in another account is not found', async () => {
      const response = await command('docs.renameDoc', {
        docId: '00000000-0000-4000-8000-999999999999',
        title: 'Mine now',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN a document is added without a name', () => {
    async function addUnnamed(): Promise<string> {
      return (await command('docs.createDoc', { projectId })).json<{ id: string }>().id;
    }

    it('THEN the first is called New doc', async () => {
      // Named here rather than on the screen, because two people adding one at
      // the same moment would otherwise both find `New doc` free.
      const made = await addUnnamed();

      expect((await doc(made)).document?.title).toBe('New doc');
    });

    it('THEN each one after it is numbered off the last', async () => {
      await addUnnamed();
      await addUnnamed();
      await addUnnamed();

      expect((await doc()).documents.map((each) => each.title)).toEqual([
        'New doc',
        'New doc 2',
        'New doc 3',
      ]);
    });

    it('THEN a name freed by a rename is used again rather than skipped', async () => {
      const first = await addUnnamed();
      await addUnnamed();

      await command('docs.renameDoc', { docId: first, title: 'Game design' });

      const made = await addUnnamed();

      expect((await doc(made)).document?.title).toBe('New doc');
    });

    it('THEN it arrives empty, ready to be written in', async () => {
      const made = await addUnnamed();

      const view = await doc(made);

      expect(view.document?.body).toBe('');
      // Nobody has written in it, so no name is against it yet.
      expect(view.document?.updatedBy).toBeNull();
    });
  });

  describe('WHEN a markdown file is imported', () => {
    it('THEN the document arrives with the prose already in it', async () => {
      // One command rather than two: a create followed by a write can fail
      // halfway and leave an empty tab named after a file nobody can see.
      const body = ['# Drowned Reach', '', 'A game about lamps.'].join(NEWLINE);

      const imported = (
        await command('docs.createDoc', { projectId, title: 'Drowned Reach', body })
      ).json<{ id: string }>().id;

      expect((await doc(imported)).document?.body).toBe(body);
    });

    it('THEN a document made without one is still empty, not undefined', async () => {
      const design = await addDoc('Game design');

      expect((await doc(design)).document?.body).toBe('');
    });

    it('THEN a file longer than a document may be is refused whole', async () => {
      const response = await command('docs.createDoc', {
        projectId,
        title: 'Too much',
        body: 'x'.repeat(400_001),
      });

      // Refused rather than truncated, and refused before the tab exists.
      expect(response.statusCode).toBe(422);
      expect((await doc()).documents).toEqual([]);
    });
  });

  describe('WHEN a document says who last wrote it', () => {
    it('THEN nobody is named until somebody has written in it', async () => {
      // An empty document has not been written by anyone, and a name against a
      // blank page is a claim nobody made.
      const design = await addDoc('Game design');

      expect((await doc(design)).document?.updatedBy).toBeNull();
    });

    it('THEN writing it puts the writer against it', async () => {
      const design = await addDoc('Game design');

      await write(design, 'Mine.');

      expect((await doc(design)).document?.updatedBy).toBe('Jake Winters');
    });

    it('THEN renaming it counts, because the date beside the name moved too', async () => {
      const design = await addDoc('Game design');

      await command('docs.renameDoc', { docId: design, title: 'Game design v2' });

      expect((await doc(design)).document?.updatedBy).toBe('Jake Winters');
    });

    it('THEN an import is written by whoever imported it', async () => {
      const imported = (
        await command('docs.createDoc', { projectId, title: 'From a file', body: 'Read in.' })
      ).json<{ id: string }>().id;

      expect((await doc(imported)).document?.updatedBy).toBe('Jake Winters');
    });
  });

  describe('WHEN somebody asks for documents they may not see', () => {
    it('THEN the owner is told they may write, so the screen and the command agree', async () => {
      expect((await doc()).canWrite).toBe(true);
    });

    it('THEN a project in another account is not found', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/docs.designDoc?slug=nothing-here',
        cookies: { lpm_session: ownerCookie },
      });

      expect(response.statusCode).toBe(404);
    });

    it('THEN somebody without a session is refused', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/docs.designDoc?slug=saltmarsh',
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
