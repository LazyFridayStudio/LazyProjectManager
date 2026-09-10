import { Redis } from 'ioredis';
import pg from 'pg';

/** Where to connect to issue `drop database`, which cannot run from inside it. */
const MAINTENANCE_DATABASE = 'postgres';

/**
 * A database this is allowed to destroy.
 *
 * `drop database` is not a thing to run on a name that arrived by accident. The
 * end-to-end suite derives its own name by suffixing the development one, so
 * anything without this in it is a sign the wrong connection string was handed
 * over — and the right answer to that is to stop, not to proceed.
 */
const DISPOSABLE_NAME = /(e2e|test)/;

/**
 * Gives the end-to-end run an empty database to sign up into.
 *
 * The first screen a fresh install shows is "Set up this server", and it is
 * shown exactly once — so a suite that started from whatever the last run left
 * behind could not test the first thing a person sees. Nothing short of an empty
 * database is real isolation here either: these tests drive the product through
 * a browser, so anything else leaves them asserting against yesterday's cards.
 *
 * Run from the web server's start command rather than from Playwright's
 * `globalSetup`, because Playwright starts the server first and the server
 * migrates the database on the way up.
 */
async function resetDatabase() {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL is not set. This script is run by the end-to-end config.');
  }

  const target = new URL(connectionString);
  const name = decodeURIComponent(target.pathname.replace(/^\//, ''));

  if (!DISPOSABLE_NAME.test(name)) {
    throw new Error(
      `Refusing to drop "${name}": an end-to-end database is named for what it is. ` +
        'Set E2E_DATABASE_URL to one whose name says so.',
    );
  }

  const maintenance = new URL(target.toString());
  maintenance.pathname = `/${MAINTENANCE_DATABASE}`;

  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();

  try {
    // Anything still connected — a server left running from a previous run —
    // would otherwise make the drop fail rather than the run start clean.
    await client.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
      [name],
    );

    // The name is checked above and comes from our own connection string; an
    // identifier cannot be parameterised.
    await client.query(`drop database if exists "${name}"`);
    await client.query(`create database "${name}"`);
  } finally {
    await client.end();
  }
}

/**
 * Empties the run's Redis as well.
 *
 * The rate limiter counts there, and its counters outlive a run: sign-in and
 * first-run setup are held to a handful an hour on purpose, so a suite that kept
 * yesterday's counts would start failing on its sixth run of the afternoon —
 * which is the limiter working, in a place nobody meant to test it.
 */
async function resetRedis() {
  const url = process.env.REDIS_URL;

  if (url === undefined || url === '') {
    return;
  }

  const redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });

  try {
    await redis.connect();
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}

await resetDatabase();
await resetRedis();
