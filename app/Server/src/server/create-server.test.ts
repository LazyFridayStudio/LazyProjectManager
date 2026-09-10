import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Database } from '@lpm/database';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';

import { createStubObjectStore, type ObjectStore } from '../storage/index.js';
import { createStubRedis } from '../testing/index.js';
import { createServer } from './create-server.js';
import { readEnvironment, type Environment } from './environment.js';

const BASE_ENVIRONMENT = {
  NODE_ENV: 'test',
  BASE_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://lpm:lpm@localhost:5432/lpm_test',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'lpm-test',
  S3_ACCESS_KEY: 'lpm',
  S3_SECRET_KEY: 'lpm-dev-secret',
} as const;

const testEnvironment: Environment = readEnvironment(BASE_ENVIRONMENT);

/** Answers its probe, and reports an install that has not been set up. */
function createReachableDatabase(): Database {
  return {
    selectNoFrom: () => ({ executeTakeFirstOrThrow: () => Promise.resolve({ probe: 1 }) }),
    selectFrom: () => ({ select: () => ({ executeTakeFirst: () => Promise.resolve(undefined) }) }),
  } as unknown as Database;
}

function createUnreachableDatabase(): Database {
  return {
    selectNoFrom: () => ({
      executeTakeFirstOrThrow: () => Promise.reject(new Error('connection refused')),
    }),
    selectFrom: () => ({
      select: () => ({ executeTakeFirst: () => Promise.reject(new Error('connection refused')) }),
    }),
  } as unknown as Database;
}

describe('GIVEN an API server with its dependencies injected', () => {
  let server: FastifyInstance | undefined;

  async function startServer(dependencies: {
    database: Database;
    storage?: ObjectStore;
    redis: Redis;
    environment?: Environment;
  }): Promise<FastifyInstance> {
    server = await createServer({
      environment: dependencies.environment ?? testEnvironment,
      database: dependencies.database,
      redis: dependencies.redis,
      storage: dependencies.storage ?? createStubObjectStore(),
    });

    return server;
  }

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  describe('WHEN the container asks whether the process is alive', () => {
    it('THEN it answers without touching any dependency', async () => {
      const api = await startServer({
        database: createUnreachableDatabase(),
        redis: createStubRedis(),
      });

      const response = await api.inject({ method: 'GET', url: '/health' });

      // A dependency being briefly slow must not get the container restarted.
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    });
  });

  describe('WHEN every dependency answers', () => {
    it('THEN system.health reports ok, and names what it probed', async () => {
      const api = await startServer({
        database: createReachableDatabase(),
        redis: createStubRedis(),
      });

      const response = await api.inject({ method: 'GET', url: '/api/q/system.health' });
      const body = response.json<{ data: { status: string; dependencies: { name: string }[] } }>();

      expect(response.statusCode).toBe(200);
      expect(body.data.status).toBe('ok');
      expect(body.data.dependencies.map((dependency) => dependency.name)).toEqual([
        'postgres',
        'redis',
      ]);
    });

    it('THEN it reports the version stamped into the image', async () => {
      process.env.APP_VERSION = '9.9.9';

      const api = await startServer({
        database: createReachableDatabase(),
        redis: createStubRedis(),
      });
      const response = await api.inject({ method: 'GET', url: '/api/q/system.health' });

      delete process.env.APP_VERSION;

      // Read from APP_VERSION, not package.json: the container starts Node
      // directly, so npm_package_version is never set and every release would
      // otherwise report the same hardcoded string.
      expect(response.json<{ data: { version: string } }>().data.version).toBe('9.9.9');
    });

    it('THEN it can be probed without a session, so a client can check before signing in', async () => {
      const api = await startServer({
        database: createReachableDatabase(),
        redis: createStubRedis(),
      });

      const response = await api.inject({ method: 'GET', url: '/api/q/system.health' });

      expect(response.statusCode).not.toBe(401);
    });
  });

  describe('WHEN a dependency is down', () => {
    it('THEN it reports degraded rather than failing the request', async () => {
      const api = await startServer({
        database: createUnreachableDatabase(),
        redis: createStubRedis(),
      });

      const response = await api.inject({ method: 'GET', url: '/api/q/system.health' });

      // The connect screen must be able to say "the server is up but
      // unhealthy". A 500 would render as "no server at this address".
      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: { status: string } }>().data.status).toBe('degraded');
    });
  });
});

describe('GIVEN an API server that also serves the web client', () => {
  let server: FastifyInstance | undefined;

  async function startServerServingWebClient(): Promise<FastifyInstance> {
    const webRoot = await mkdtemp(join(tmpdir(), 'lpm-web-'));
    await writeFile(join(webRoot, 'index.html'), '<!doctype html><title>app shell</title>', 'utf8');
    // Laid out the way a build lays it out: hashed files under `assets`, and the
    // handful somebody named beside the shell.
    await mkdir(join(webRoot, 'assets'));
    await writeFile(join(webRoot, 'assets', 'app-a1b2c3.js'), 'globalThis.loaded = true;', 'utf8');
    await writeFile(join(webRoot, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8');

    server = await createServer({
      environment: readEnvironment({ ...BASE_ENVIRONMENT, WEB_ROOT: webRoot }),
      database: createReachableDatabase(),
      redis: createStubRedis(),
      storage: createStubObjectStore(),
    });

    return server;
  }

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  describe('WHEN a built asset is requested', () => {
    it('THEN it is served', async () => {
      const api = await startServerServingWebClient();

      const response = await api.inject({ method: 'GET', url: '/assets/app-a1b2c3.js' });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('globalThis.loaded');
    });

    it('THEN it is cached indefinitely, because its filename is content-hashed', async () => {
      const api = await startServerServingWebClient();

      const response = await api.inject({ method: 'GET', url: '/assets/app-a1b2c3.js' });

      expect(response.headers['cache-control']).toContain('immutable');
    });
  });

  describe('WHEN a file somebody named is requested', () => {
    it('THEN it is kept for an hour rather than forever, because the name outlives the file', async () => {
      const api = await startServerServingWebClient();

      const response = await api.inject({ method: 'GET', url: '/icon.svg' });

      /*
       * The favicon is the case this exists for. Its name never changes, so
       * `immutable` would promise a browser that a mark it fetched last year is
       * still the mark — and browsers keep that promise, which is what makes it
       * the wrong one to give.
       */
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).not.toContain('immutable');
      expect(response.headers['cache-control']).toBe('public, max-age=3600');
    });
  });

  describe('WHEN a client-side route is opened directly', () => {
    it('THEN the app shell is returned so deep links work', async () => {
      const api = await startServerServingWebClient();

      const response = await api.inject({ method: 'GET', url: '/projects/some-project/board' });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('app shell');
    });

    it('THEN the shell is not cached, so a deploy is visible on the next load', async () => {
      const api = await startServerServingWebClient();

      const response = await api.inject({ method: 'GET', url: '/some/client/route' });

      expect(response.headers['cache-control']).toBe('no-cache');
    });
  });

  describe('WHEN an unknown API route is requested', () => {
    it('THEN it answers JSON, never the app shell', async () => {
      const api = await startServerServingWebClient();

      // Without this the client receives HTML where it expected a failure
      // envelope, and reports a parse error instead of "unknown query".
      const response = await api.inject({ method: 'GET', url: '/api/q/board.doesNotExist' });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    });
  });
});

describe('GIVEN the environment a server boots from', () => {
  describe('WHEN required variables are missing', () => {
    it('THEN every one of them is named at once, not just the first', () => {
      expect(() => readEnvironment({ NODE_ENV: 'test' })).toThrow(/BASE_URL[\s\S]*DATABASE_URL/);
    });
  });

  describe('WHEN optional variables are left unset', () => {
    it('THEN TRUST_PROXY defaults off, so a direct install trusts no forged headers', () => {
      expect(testEnvironment.TRUST_PROXY).toBe(false);
    });

    it('THEN migrations do not run on boot outside the container', () => {
      expect(testEnvironment.RUN_MIGRATIONS_ON_BOOT).toBe(false);
    });

    it('THEN no web root is set, because Vite serves the client in development', () => {
      expect(testEnvironment.WEB_ROOT).toBeUndefined();
    });
  });
});
