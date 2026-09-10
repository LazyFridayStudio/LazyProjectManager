import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import type { Database } from '@lpm/database';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import type { Redis } from 'ioredis';

import { createFailure } from '@lpm/shared';

import { createCommandRegistry } from '../cqrs/command-registry.js';
import { createQueryRegistry } from '../cqrs/query-registry.js';
import { registerCqrsRoutes } from '../cqrs/register-cqrs-routes.js';
import { registerFileRoutes } from '../modules/files/index.js';
import { registerWebhookRoute } from '../modules/scm/index.js';
import { InvalidationHub, registerRealtimeRoute } from '../realtime/index.js';
import { type ObjectStore } from '../storage/index.js';
import type { FetchLike } from '../modules/scm/forge/github-app.js';
import type { RequestContext } from '../cqrs/request-context.js';
import {
  createSessionCookieWriter,
  findActorForRequest,
  readSessionToken,
} from '../modules/identity/index.js';
import { commandHandlers, queryHandlers } from '../modules/index.js';
import type { Environment } from './environment.js';
import { registerErrorHandler } from './error-handler.js';
import { isRateLimited, readRateLimitTarget } from './rate-limit-policy.js';
import { serveWebClient } from './serve-web-client.js';

export interface ServerDependencies {
  readonly environment: Environment;
  readonly database: Database;
  readonly redis: Redis;
  /**
   * Supplied rather than built here so a test can hand over one that answers
   * without a store behind it.
   */
  readonly storage: ObjectStore;
  /**
   * How the server reaches anything outside itself — which today is one forge,
   * asked whether an app's credentials work.
   *
   * Injected for the reason `storage` is: a test that had to stand up a forge,
   * or reach the real one, would be a test nobody runs.
   */
  readonly fetch?: FetchLike;
}

/**
 * Builds the HTTP server.
 *
 * Dependencies are passed in rather than constructed here so a test can hand it
 * a throwaway database and drive real requests through `server.inject()` without
 * opening a port.
 */
export async function createServer(dependencies: ServerDependencies): Promise<FastifyInstance> {
  const server = Fastify({
    logger: buildLoggerOptions(dependencies.environment),
    // Behind a Cloudflare tunnel every request arrives from the connector, so
    // without this the client IP recorded on a session is the tunnel's and
    // request.protocol is always http.
    trustProxy: dependencies.environment.TRUST_PROXY,
    disableRequestLogging: false,
  });

  // Registered before the routes, so `request.cookies` is populated by the time
  // a context is built.
  await server.register(fastifyCookie);
  await server.register(fastifyWebsocket);
  await registerRateLimits(server, dependencies.redis);

  registerErrorHandler(server);
  registerLivenessRoute(server);

  registerFileRoutes(server, {
    database: dependencies.database,
    storage: dependencies.storage,
  });

  registerWebhookRoute(server, {
    database: dependencies.database,
    environment: dependencies.environment,
  });

  registerRealtimeRoute(server, {
    database: dependencies.database,
    hub: new InvalidationHub(dependencies.redis.duplicate()),
  });

  registerCqrsRoutes(server, {
    queries: createQueryRegistry(queryHandlers),
    commands: createCommandRegistry(commandHandlers),
    createContext: (request, reply) => createRequestContext(request, reply, dependencies),
  });

  // Registered last so the single-page-app fallback cannot shadow an API route.
  const { WEB_ROOT: webRoot } = dependencies.environment;

  if (webRoot !== undefined) {
    await serveWebClient(server, webRoot);
  }

  return server;
}

/**
 * Liveness only: is this process answering at all.
 *
 * Deliberately separate from the `system.health` query, which probes Postgres
 * and Redis. A container healthcheck must not go unhealthy — and get the process
 * restarted — because a dependency is briefly slow.
 */
/**
 * How much any one caller may ask for.
 *
 * Counted in Redis rather than in memory, so the limit is the install's rather
 * than each process's — two replicas behind a tunnel would otherwise allow twice
 * what was configured, and a restart would forget every count.
 *
 * The policy itself is in `rate-limit-policy`, which is a pure function of the
 * path: what is limited and how hard belongs somewhere it can be read and
 * tested, not spread through plugin options.
 */
async function registerRateLimits(server: FastifyInstance, redis: Redis): Promise<void> {
  await server.register(fastifyRateLimit, {
    global: true,
    // Its own connection: a limiter that shared the subscriber would be a
    // limiter that stops working the moment something subscribes.
    redis: redis.duplicate(),
    nameSpace: 'lpm:rate:',
    /**
     * A Redis that is down must not take the API down with it.
     *
     * Failing open lets somebody past a limit during an outage. Failing closed
     * refuses everybody, including the people trying to fix it — which is the
     * worse of the two for a tracker a studio runs itself.
     */
    skipOnError: true,
    allowList: (request) => !isRateLimited(request.url),
    keyGenerator: (request) => {
      const target = readRateLimitTarget(request.url);

      return target.perAddress ? `${request.ip}:${target.bucket}` : target.bucket;
    },
    max: (request) => readRateLimitTarget(request.url).policy.max,
    timeWindow: (request) => readRateLimitTarget(request.url).policy.windowMs,
    // The app's own failure shape, so a client reads a refusal the same way it
    // reads every other one rather than special-casing this plugin's.
    errorResponseBuilder: (_request, context) =>
      createFailure(
        'RATE_LIMITED',
        `That is more than this server accepts just now. Try again in ${context.after}.`,
      ),
  });
}

function registerLivenessRoute(server: FastifyInstance): void {
  server.get('/health', () => ({ status: 'ok' as const }));
}

async function createRequestContext(
  request: FastifyRequest,
  reply: FastifyReply,
  dependencies: ServerDependencies,
): Promise<RequestContext> {
  // Read here as well as inside the resolver, because the context carries it:
  // `identity.signOut` revokes the token the request arrived on. A cookie is a
  // property lookup, so reading it twice is cheaper than a parameter that would
  // let a caller hand in a token the request never carried.
  const sessionToken = readSessionToken(request);

  return {
    database: dependencies.database,
    redis: dependencies.redis,
    storage: dependencies.storage,
    fetch: dependencies.fetch ?? fetch,
    environment: dependencies.environment,
    logger: request.log,
    actor: await findActorForRequest(dependencies.database, request),
    sessionToken,
    sessionCookie: createSessionCookieWriter(request, reply),
    origin: {
      userAgent: request.headers['user-agent'] ?? null,
      // `request.ip` reads the forwarded headers only when TRUST_PROXY is on, so
      // an install exposed directly cannot be fed a spoofed address.
      ipAddress: request.ip,
    },
  };
}

function buildLoggerOptions(environment: Environment): { level: string } | boolean {
  if (environment.NODE_ENV === 'test') {
    return false;
  }

  return { level: environment.NODE_ENV === 'production' ? 'info' : 'debug' };
}
