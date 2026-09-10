import { createDatabase, type Database } from '@lpm/database';
import { Redis } from 'ioredis';
import { z } from 'zod';

import {
  createInvalidationPublisher,
  createThumbnailMaker,
  type DomainEventConsumer,
} from './outbox/index.js';
import { ObjectStore } from './storage/index.js';
import { runOutboxLoop } from './worker/run-outbox-loop.js';

const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  /**
   * The same key the API encrypts a repository's private key with.
   *
   * The worker needs it to read that key back and mint a token, which is how it
   * keeps the board and the issue list in step on the half hour. Optional, for
   * the reason the API's is: an install with no repository connected has
   * nothing to decrypt, and should not refuse to boot over a feature it does
   * not use.
   */
  APP_SECRET: z.preprocess(
    // `.env.example` ships this empty, so an operator who copies it unchanged
    // hands the process an empty string rather than nothing at all.
    (value) => (value === '' ? undefined : value),
    z.string().min(16).optional(),
  ),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** How long to wait after an empty pass before looking again. */
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),

  /**
   * Where the worker says it is still going round.
   *
   * A worker has no HTTP server to ask, so "is it alive" has to be answered
   * some other way — and "the process has not exited" is not the same question.
   * A worker wedged on something it cannot finish is still a running process,
   * and this is what tells the difference.
   */
  WORKER_HEARTBEAT_FILE: z.string().min(1).default('/tmp/lpm-worker-heartbeat'),
});

/**
 * Consumers registered here receive every domain event.
 *
 * The drain runs whether or not any of them care about a given event, so one
 * nothing listens for is marked processed rather than piling up.
 */
function createConsumers(
  redis: Redis,
  database: Database,
  storage: ObjectStore,
): readonly DomainEventConsumer[] {
  return [createInvalidationPublisher(redis), createThumbnailMaker(database, storage)];
}

async function startWorker(): Promise<void> {
  const environment = environmentSchema.parse(process.env);
  const database = createDatabase({
    connectionString: environment.DATABASE_URL,
    maxConnections: 4,
  });

  const redis = new Redis(environment.REDIS_URL);

  // No public endpoint: the worker never hands a URL to anybody, it only reads
  // and writes objects itself.
  const storage = new ObjectStore({
    endpoint: environment.S3_ENDPOINT,
    bucket: environment.S3_BUCKET,
    accessKey: environment.S3_ACCESS_KEY,
    secretKey: environment.S3_SECRET_KEY,
    forcePathStyle: environment.S3_FORCE_PATH_STYLE,
  });

  /*
   * Asked to stop rather than cut off.
   *
   * The loop checks between passes, so a shutdown lands after the pass in
   * flight rather than part-way through a drain — an event marked processed by
   * a statement that never committed is the one thing worth waiting a moment
   * for. Docker sends SIGKILL ten seconds later if a pass has hung, which is
   * the right answer to a pass that has hung.
   */
  const stopping = new AbortController();

  process.on('SIGTERM', () => {
    stopping.abort();
  });
  process.on('SIGINT', () => {
    stopping.abort();
  });

  process.stdout.write('Outbox worker started.\n');

  try {
    await runOutboxLoop({
      database,
      consumers: createConsumers(redis, database, storage),
      pollIntervalMs: environment.OUTBOX_POLL_INTERVAL_MS,
      heartbeatFile: environment.WORKER_HEARTBEAT_FILE,
      appSecret: environment.APP_SECRET,
      signal: stopping.signal,
    });
  } finally {
    redis.disconnect();
    await database.destroy();
  }
}

try {
  await startWorker();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unknown startup error'}\n`);

  /*
   * Exit, rather than ask to.
   *
   * `process.exitCode = 1` says "leave with this code once there is nothing
   * left to do", and there always was: the Redis connection and the pg pool
   * hold the event loop open. So a worker that failed to start sat there for
   * ever, alive and doing nothing, and `restart: unless-stopped` never fired
   * because nothing had stopped.
   */
  process.exit(1);
}
