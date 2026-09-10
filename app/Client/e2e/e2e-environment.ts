import { fileURLToPath } from 'node:url';

/**
 * The port the API under test listens on.
 *
 * Not 3000, which `pnpm dev` uses, and not the compose stack's published port
 * either — a suite that quietly talked to a running development server would
 * pass or fail on what happened to be in that database.
 */
export const E2E_PORT = 4173;

export const E2E_ORIGIN = `http://127.0.0.1:${String(E2E_PORT)}`;

/** Suffixed rather than shared: a test run truncates what it points at. */
const E2E_DATABASE_SUFFIX = '_e2e';

const fromRepositoryRoot = (relativePath: string): string =>
  fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url));

/**
 * The database the suite owns, which it is free to drop and rebuild.
 *
 * Derived from `DATABASE_URL` by name so one connection string still configures
 * everything, and never equal to it: these tests sign up an owner, make
 * projects and move cards about, and doing that to the database somebody is
 * developing against would be a rude surprise. `E2E_DATABASE_URL` overrides it
 * outright for anyone who wants the two somewhere else entirely.
 */
export function readE2eDatabaseUrl(): string {
  const override = process.env.E2E_DATABASE_URL;

  if (override !== undefined && override !== '') {
    return override;
  }

  const url = new URL(requireEnvironment('DATABASE_URL'));
  url.pathname = `${url.pathname.replace(/\/$/, '')}${E2E_DATABASE_SUFFIX}`;

  return url.toString();
}

/**
 * The same environment the container runs with, pointed at the test database.
 *
 * `WEB_ROOT` is what makes this one process rather than two: the API serves the
 * built client from the same origin, which is exactly how the product ships, so
 * the suite exercises the deployment rather than a development arrangement that
 * only exists on a developer's machine.
 */
export function readE2eServerEnvironment(): Record<string, string> {
  return {
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(E2E_PORT),
    BASE_URL: E2E_ORIGIN,
    SERVER_NAME: 'LazyProjectManager',
    DATABASE_URL: readE2eDatabaseUrl(),
    REDIS_URL: readE2eRedisUrl(),
    S3_ENDPOINT: requireEnvironment('S3_ENDPOINT'),
    S3_BUCKET: process.env.S3_BUCKET ?? 'lpm-e2e',
    S3_ACCESS_KEY: requireEnvironment('S3_ACCESS_KEY'),
    S3_SECRET_KEY: requireEnvironment('S3_SECRET_KEY'),
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE ?? 'true',
    /*
     * The key repository secrets are encrypted with.
     *
     * Stated here rather than inherited. Playwright loads the repository's
     * `.env` into this process, so a developer who happened to have an
     * `APP_SECRET` got a server that could connect a repository and a developer
     * who did not got one that could not — and CI, which has no `.env` at all,
     * was always the second kind.
     *
     * That is how connecting a repository went untested: the only suite that
     * could have covered it was quietly missing the one value it needed. A
     * fixed string is right here, because a suite that generates its own key
     * cannot be told apart from one that is reading somebody's real one.
     */
    APP_SECRET: 'an-end-to-end-key-that-is-a-secret-nowhere',
    WEB_ROOT: fromRepositoryRoot('app/Client/dist'),
    // The suite drops the schema before every run, so the server is the one
    // putting it back.
    RUN_MIGRATIONS_ON_BOOT: 'true',
  };
}

/**
 * A Redis of its own, so a run starts with the counters clear.
 *
 * The rate limiter counts in Redis, and its counters outlive a run — sign-in and
 * first-run setup are deliberately held to a handful an hour, so a suite that
 * shared the development Redis would start failing on its sixth run of the
 * afternoon. That is the limiter working, in a place nobody meant to test it.
 *
 * A logical database rather than another server: same connection, nothing to
 * install, and `select 15` is not something anything else here uses.
 */
export function readE2eRedisUrl(): string {
  const url = new URL(requireEnvironment('REDIS_URL'));
  url.pathname = `/${String(E2E_REDIS_DATABASE)}`;

  return url.toString();
}

/** The last of the sixteen a default Redis has, so nothing is likely to want it. */
export const E2E_REDIS_DATABASE = 15;

function requireEnvironment(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set. End-to-end tests need Postgres, Redis and an S3 store; ` +
        'copy .env.example to .env and run `pnpm stack:up`.',
    );
  }

  return value;
}
