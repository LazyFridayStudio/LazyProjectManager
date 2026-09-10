import { createDatabase, runMigrations, type Database } from '@lpm/database';
import { Redis } from 'ioredis';

import { createServer } from './server/create-server.js';
import { ObjectStore } from './storage/index.js';
import { readEnvironment, type Environment } from './server/environment.js';

/**
 * Process entrypoint.
 *
 * Everything it does is wiring: read the environment, open the connections, hand
 * them to the server, and make sure both are closed on the way out. All
 * behaviour lives in the modules.
 */
async function startApi(): Promise<void> {
  const environment = readEnvironment();

  if (environment.RUN_MIGRATIONS_ON_BOOT) {
    await applyPendingMigrations(environment.DATABASE_URL);
  }

  const database = createDatabase({ connectionString: environment.DATABASE_URL });
  const redis = new Redis(environment.REDIS_URL, { maxRetriesPerRequest: null });

  const storage = new ObjectStore({
    endpoint: environment.S3_ENDPOINT,
    bucket: environment.S3_BUCKET,
    accessKey: environment.S3_ACCESS_KEY,
    secretKey: environment.S3_SECRET_KEY,
    forcePathStyle: environment.S3_FORCE_PATH_STYLE,
  });

  // A self-hosted install should not need somebody to open a console and make a
  // bucket before the first upload works.
  await storage.ensureBucket();

  const server = await createServer({ environment, database, redis, storage });

  closeConnectionsOnShutdown({ server: () => server.close(), database, redis });

  await server.listen({ host: environment.HOST, port: environment.PORT });
  server.log.info(`${environment.SERVER_NAME} listening on ${describeOrigin(environment)}`);
}

function describeOrigin(environment: Environment): string {
  return `${environment.HOST}:${String(environment.PORT)} (public ${environment.BASE_URL})`;
}

/**
 * Brings the schema up to date before the server accepts traffic.
 *
 * This is what makes upgrading a self-hosted install `docker compose pull` and
 * nothing else. Kysely's migrator takes a lock, so several replicas starting at
 * once is safe: one applies the migration and the rest wait, then find nothing
 * to do.
 */
async function applyPendingMigrations(connectionString: string): Promise<void> {
  const { error, results } = await runMigrations(connectionString);

  for (const result of results ?? []) {
    process.stdout.write(`migration ${result.status}: ${result.migrationName}\n`);
  }

  if (error !== undefined) {
    throw error instanceof Error ? error : new Error('Migration failed');
  }
}

interface ShutdownTargets {
  readonly server: () => Promise<void>;
  readonly database: Database;
  readonly redis: Redis;
}

/**
 * Drains in-flight requests before dropping the connections.
 *
 * Docker sends SIGTERM on `compose down` and on every redeploy. Without this the
 * process dies mid-request and the client sees a reset rather than a response.
 */
function closeConnectionsOnShutdown(targets: ShutdownTargets): void {
  let alreadyClosing = false;

  const shutDown = (signal: NodeJS.Signals): void => {
    if (alreadyClosing) {
      return;
    }

    alreadyClosing = true;
    process.stdout.write(`\nReceived ${signal}, shutting down.\n`);

    void targets
      .server()
      .then(() => targets.database.destroy())
      .then(() => {
        targets.redis.disconnect();
        process.exit(0);
      });
  };

  process.on('SIGTERM', shutDown);
  process.on('SIGINT', shutDown);
}

try {
  await startApi();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unknown startup error'}\n`);
  process.exitCode = 1;
}
