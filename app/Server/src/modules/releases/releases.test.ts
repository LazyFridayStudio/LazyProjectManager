import { generateKeyPairSync } from 'node:crypto';

import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import type { BuildsView } from '@lpm/shared';
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
  // Connecting a repository encrypts its webhook secret with this.
  APP_SECRET: 'a key this test server was started with',
  DATABASE_URL: 'postgres://unused',
  REDIS_URL: 'redis://unused',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'unused',
  S3_ACCESS_KEY: 'unused',
  S3_SECRET_KEY: 'unused',
});

describe('GIVEN a project with releases to record', () => {
  let testDatabase: TestDatabase;
  let server: FastifyInstance;
  let passwordHash: string;
  let ownerCookie: string;
  let projectId: string;
  let commandCount = 0;

  // The sign-in limiter counts in Redis and its counters outlive a test, so a
  // suite that signs in per test starts failing partway through without this.
  const redis = createStubRedis();

  /** What the forge says next. Reassigned per test. */
  let forge: (url: string, init?: RequestInit) => Promise<Response>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    passwordHash = await hashPassword(PASSWORD);
    server = await createServer({
      database: testDatabase.database,
      redis,
      storage: createStubObjectStore(),
      environment: testEnvironment,
      // Answered by the test rather than by GitHub. A suite that reached the
      // real forge would be a suite that fails when somebody is on a train.
      fetch: (url, init) => forge(url, init),
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
    forge = () => Promise.reject(new Error('no forge answer was set up for this test'));

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

    return response.cookies.find((each) => each.name === 'lpm_session')?.value ?? '';
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

  async function builds(): Promise<BuildsView> {
    const response = await server.inject({
      method: 'GET',
      url: '/api/q/releases.builds?slug=saltmarsh',
      cookies: { lpm_session: ownerCookie },
    });

    return response.json<{ data: BuildsView }>().data;
  }

  async function record(
    fields: Record<string, unknown>,
  ): Promise<Awaited<ReturnType<typeof server.inject>>> {
    return command('releases.record', {
      projectId,
      tag: 'v0.9.4',
      name: 'Vertical slice',
      publishedOn: '2026-08-14',
      author: 'build-bot',
      ...fields,
    });
  }

  describe('WHEN a project has shipped nothing', () => {
    it('THEN it answers with nothing rather than refusing', async () => {
      const view = await builds();

      expect(view.latest).toBeNull();
      expect(view.earlier).toEqual([]);
    });
  });

  describe('WHEN releases are recorded', () => {
    it('THEN the newest is the headline and the rest are history', async () => {
      await record({ tag: 'v0.9.2', publishedOn: '2026-07-18' });
      await record({ tag: 'v0.9.4', publishedOn: '2026-08-14' });
      await record({ tag: 'v0.9.3', publishedOn: '2026-08-01' });

      const view = await builds();

      // By the day it was published, not the order somebody typed them in.
      expect(view.latest?.tag).toBe('v0.9.4');
      expect(view.earlier.map((release) => release.tag)).toEqual(['v0.9.3', 'v0.9.2']);
    });

    it('THEN two on the same day keep a settled order rather than shuffling', async () => {
      await record({ tag: 'v1.0.0-a', publishedOn: '2026-08-14' });
      await record({ tag: 'v1.0.0-b', publishedOn: '2026-08-14' });

      // Recorded second, so newer: a page whose order changes between loads is
      // one nobody trusts.
      expect((await builds()).latest?.tag).toBe('v1.0.0-b');
    });

    it('THEN the notes come back exactly as they were written', async () => {
      const notes = ['## Added', '', '- Tier-3 weapon set'].join(NEWLINE);

      await record({ notes });

      expect((await builds()).latest?.notes).toBe(notes);
    });

    it('THEN the downloads arrive with it, in the order they were given', async () => {
      await record({
        assets: [
          { name: 'win64.zip', sizeBytes: 4_509_715_661, downloadCount: 38 },
          { name: 'ps5.pkg', sizeBytes: 5_476_083_302, downloadCount: 12 },
        ],
      });

      const assets = (await builds()).latest?.assets ?? [];

      expect(assets.map((asset) => asset.name)).toEqual(['win64.zip', 'ps5.pkg']);
      // `bigint` arrives from `pg` as a string; a size that came back as one
      // would compare and sort wrongly everywhere it was used.
      expect(assets[0]?.sizeBytes).toBe(4_509_715_661);
      expect(typeof assets[0]?.sizeBytes).toBe('number');
    });

    it('THEN a download says where it is, so the page can hand it over', async () => {
      await record({
        assets: [
          {
            name: 'win64.zip',
            sizeBytes: 4_509_715_661,
            downloadUrl: 'https://builds.northwind.test/win64.zip',
          },
        ],
      });

      expect((await builds()).latest?.assets[0]?.downloadUrl).toBe(
        'https://builds.northwind.test/win64.zip',
      );
    });

    it('THEN a download nobody linked is null rather than missing, so the row offers nothing', async () => {
      await record({ assets: [{ name: 'win64.zip' }] });

      // Not an error: a studio recording what it shipped is not always
      // recording where it put it.
      expect((await builds()).latest?.assets[0]?.downloadUrl).toBeNull();
    });

    it('THEN a link that is not a link is refused, where the person typing it can be told', async () => {
      const response = await command('releases.record', {
        projectId,
        tag: 'v0.9.9',
        name: 'Bad link',
        publishedOn: '2026-08-14',
        author: 'Jake',
        assets: [{ name: 'win64.zip', downloadUrl: 'not a url' }],
      });

      expect(response.statusCode).toBe(422);
    });

    it('THEN a release with no downloads has an empty list, not a missing one', async () => {
      await record({});

      expect((await builds()).latest?.assets).toEqual([]);
    });

    it('THEN a file nobody measured keeps its row', async () => {
      await record({ assets: [{ name: 'unknown.zip' }] });

      const asset = (await builds()).latest?.assets[0];

      expect(asset?.name).toBe('unknown.zip');
      expect(asset?.sizeBytes).toBeNull();
    });

    it('THEN the same tag twice is refused, and says so in a sentence', async () => {
      await record({ tag: 'v0.9.4' });

      const response = await record({ tag: 'v0.9.4' });

      // A project with two v0.9.4s is one where nobody can say which build
      // somebody is running.
      expect(response.statusCode).toBe(409);
      expect(response.json<{ message: string }>().message).toContain('v0.9.4');
    });

    it('THEN the same tag on another project is fine', async () => {
      await record({ tag: 'v0.9.4' });

      const other = (await command('projects.create', { name: 'Kiln', code: 'KILN' })).json<{
        id: string;
      }>().id;

      expect((await record({ projectId: other, tag: 'v0.9.4' })).statusCode).toBe(200);
    });
  });

  describe('WHEN a release is changed', () => {
    it('THEN an absent field is left alone rather than emptied', async () => {
      const id = (await record({ commitSha: '4f2ac91', notes: 'Kept.' })).json<{ id: string }>().id;

      await command('releases.update', { releaseId: id, name: 'Renamed' });

      const view = await builds();

      expect(view.latest?.name).toBe('Renamed');
      expect(view.latest?.commitSha).toBe('4f2ac91');
      expect(view.latest?.notes).toBe('Kept.');
    });

    it('THEN the downloads given replace the ones that were there', async () => {
      const id = (await record({ assets: [{ name: 'win64.zip' }, { name: 'ps5.pkg' }] })).json<{
        id: string;
      }>().id;

      await command('releases.update', { releaseId: id, assets: [{ name: 'win64.zip' }] });

      // A download taken off a release is gone, not a row with a flag on it.
      expect((await builds()).latest?.assets.map((asset) => asset.name)).toEqual(['win64.zip']);
    });

    it('THEN leaving the downloads out leaves them where they were', async () => {
      const id = (await record({ assets: [{ name: 'win64.zip' }] })).json<{ id: string }>().id;

      await command('releases.update', { releaseId: id, name: 'Renamed' });

      expect((await builds()).latest?.assets).toHaveLength(1);
    });

    it('THEN it may keep its own tag', async () => {
      const id = (await record({ tag: 'v0.9.4' })).json<{ id: string }>().id;

      const response = await command('releases.update', {
        releaseId: id,
        tag: 'v0.9.4',
        name: 'Renamed',
      });

      expect(response.statusCode).toBe(200);
    });

    it('THEN it may not take a tag another release has', async () => {
      await record({ tag: 'v0.9.3', publishedOn: '2026-08-01' });
      const id = (await record({ tag: 'v0.9.4' })).json<{ id: string }>().id;

      expect((await command('releases.update', { releaseId: id, tag: 'v0.9.3' })).statusCode).toBe(
        409,
      );
    });
  });

  describe('WHEN a release is deleted', () => {
    it('THEN it goes, and what it listed goes with it', async () => {
      const id = (await record({ assets: [{ name: 'win64.zip' }] })).json<{ id: string }>().id;

      await command('releases.delete', { releaseId: id });

      expect((await builds()).latest).toBeNull();

      const orphans = await testDatabase.database.selectFrom('releaseAsset').select('id').execute();

      expect(orphans).toEqual([]);
    });

    it('THEN the one before it becomes the headline', async () => {
      await record({ tag: 'v0.9.3', publishedOn: '2026-08-01' });
      const id = (await record({ tag: 'v0.9.4' })).json<{ id: string }>().id;

      await command('releases.delete', { releaseId: id });

      expect((await builds()).latest?.tag).toBe('v0.9.3');
    });

    it('THEN a release in another account is not found', async () => {
      const response = await command('releases.delete', {
        releaseId: '00000000-0000-4000-8000-999999999999',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('WHEN the repository fills the page in', () => {
    /** A key that will sign, so a token can be minted with it. */
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    /** One release as GitHub answers, trimmed to what is read. */
    function forgeRelease(fields: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        id: 5551,
        tag_name: 'v0.9.4',
        name: 'Vertical slice',
        body: '## Added',
        published_at: '2026-08-14T09:12:44Z',
        target_commitish: '4f2ac91',
        prerelease: true,
        draft: false,
        html_url: 'https://github.com/northwind/reach/releases/tag/v0.9.4',
        author: { login: 'build-bot' },
        assets: [
          {
            name: 'win64.zip',
            size: 4_509_715_661,
            download_count: 38,
            browser_download_url: 'https://github.com/northwind/reach/releases/win64.zip',
          },
        ],
        ...fields,
      };
    }

    /** Hands out a token, then answers with these releases. */
    function forgeHolding(releases: readonly Record<string, unknown>[]) {
      return (url: string): Promise<Response> => {
        if (url.includes('/access_tokens')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ token: 'ghs_secret', expires_at: '2030-01-01T00:00:00Z' }),
            ),
          );
        }

        if (url.includes('/releases')) {
          return Promise.resolve(new Response(JSON.stringify(releases)));
        }

        return Promise.resolve(new Response('{}'));
      };
    }

    async function connectRepository(withApp = true): Promise<void> {
      forge = forgeHolding([]);

      await command('scm.connect', {
        projectId,
        provider: 'github',
        repoFullName: 'northwind/reach',
        webhookSecret: 'wh_2f8c1a44d0e34b1fa9c7e5b06d1a83f4_long_enough',
      });

      if (withApp) {
        await command('scm.connectApp', {
          projectId,
          appId: '412345',
          installationId: '98765',
          privateKey,
        });
      }
    }

    async function sync(): Promise<Awaited<ReturnType<typeof server.inject>>> {
      return command('releases.sync', { projectId });
    }

    it('THEN a project with no repository is told to connect one', async () => {
      const response = await sync();

      expect(response.statusCode).toBe(422);
      expect(response.json<{ message: string }>().message).toContain('no repository connected');
    });

    it('THEN one connected for events only says what is missing', async () => {
      // Every Gitea and GitLab connection is in this state today: wired up to
      // hear from, with no credential to read with.
      await connectRepository(false);

      const response = await sync();

      expect(response.statusCode).toBe(422);
      expect(response.json<{ message: string }>().message).toContain('no app installed');
    });

    it('THEN the releases the repository has arrive on the page', async () => {
      await connectRepository();
      forge = forgeHolding([forgeRelease()]);

      await sync();

      const view = await builds();

      expect(view.latest).toMatchObject({
        source: 'github',
        tag: 'v0.9.4',
        author: 'build-bot',
        isPrerelease: true,
      });
      expect(view.latest?.assets).toHaveLength(1);
    });

    it('THEN syncing twice does not double anything', async () => {
      await connectRepository();
      forge = forgeHolding([forgeRelease()]);

      await sync();
      await sync();

      expect((await builds()).earlier).toEqual([]);
      expect((await builds()).latest?.assets).toHaveLength(1);
    });

    it('THEN a release changed upstream is brought up to date', async () => {
      await connectRepository();
      forge = forgeHolding([forgeRelease()]);
      await sync();

      forge = forgeHolding([forgeRelease({ name: 'Renamed upstream', body: '## Fixed' })]);
      await sync();

      const view = await builds();

      expect(view.latest?.name).toBe('Renamed upstream');
      expect(view.latest?.notes).toBe('## Fixed');
    });

    it('THEN a tag renamed upstream moves the row rather than doubling it', async () => {
      await connectRepository();
      forge = forgeHolding([forgeRelease()]);
      await sync();

      // Same id, different tag: matching on the tag would leave the old row
      // behind as a second release nobody shipped.
      forge = forgeHolding([forgeRelease({ tag_name: 'v0.9.5' })]);
      await sync();

      const view = await builds();

      expect(view.latest?.tag).toBe('v0.9.5');
      expect(view.earlier).toEqual([]);
    });

    it('THEN a synced download keeps where the forge said it is', async () => {
      await connectRepository();
      forge = forgeHolding([forgeRelease()]);
      await sync();

      // The forge has sent this all along and the reader threw it away, which
      // is why the page could list a build and not hand it to anybody.
      expect((await builds()).latest?.assets[0]?.downloadUrl).toBe(
        'https://github.com/northwind/reach/releases/win64.zip',
      );
    });

    it('THEN a download deleted upstream stops being listed', async () => {
      await connectRepository();
      forge = forgeHolding([forgeRelease()]);
      await sync();

      forge = forgeHolding([forgeRelease({ assets: [] })]);
      await sync();

      expect((await builds()).latest?.assets).toEqual([]);
    });

    it('THEN a release somebody typed is never overwritten by the forge', async () => {
      await record({ tag: 'v0.9.4', name: 'Mine, thanks.', notes: 'Written by hand.' });
      await connectRepository();
      forge = forgeHolding([forgeRelease()]);

      await sync();

      const view = await builds();

      // The tag is taken, and what a person wrote wins over what a forge says.
      expect(view.latest?.source).toBe('hand');
      expect(view.latest?.name).toBe('Mine, thanks.');
      expect(view.latest?.notes).toBe('Written by hand.');
      expect(view.earlier).toEqual([]);
    });

    it('THEN what the repository no longer has is left on the page', async () => {
      await connectRepository();
      forge = forgeHolding([forgeRelease()]);
      await sync();

      // A release pulled last month and since removed upstream is still a
      // build somebody has.
      forge = forgeHolding([]);
      await sync();

      expect((await builds()).latest?.tag).toBe('v0.9.4');
    });

    it('THEN the page says which repository it reads and when it last did', async () => {
      await connectRepository();

      expect((await builds()).sync).toMatchObject({
        provider: 'github',
        repoFullName: 'northwind/reach',
        canRead: true,
        syncedAt: null,
      });

      forge = forgeHolding([forgeRelease()]);
      await sync();

      expect((await builds()).sync?.syncedAt).not.toBeNull();
    });

    it('THEN a forge that refuses says so in words somebody can act on', async () => {
      await connectRepository();
      forge = (url: string): Promise<Response> =>
        url.includes('/access_tokens')
          ? Promise.resolve(
              new Response(
                JSON.stringify({ token: 'ghs_secret', expires_at: '2030-01-01T00:00:00Z' }),
              ),
            )
          : Promise.resolve(new Response('{}', { status: 404 }));

      const response = await sync();

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.json<{ message: string }>().message).toContain('northwind/reach');
    });
  });

  describe('WHEN somebody asks for a page they may not see', () => {
    it('THEN the owner is told they may write, so screen and command agree', async () => {
      expect((await builds()).canWrite).toBe(true);
    });

    it('THEN a project in another account is not found', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/releases.builds?slug=nothing-here',
        cookies: { lpm_session: ownerCookie },
      });

      expect(response.statusCode).toBe(404);
    });

    it('THEN somebody without a session is refused', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/releases.builds?slug=saltmarsh',
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
