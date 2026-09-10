import { healthQuery, type DependencyHealth, type HealthView } from '@lpm/shared';
import { measureDatabaseHealth } from '@lpm/database';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import type { RequestContext } from '../../../cqrs/request-context.js';

const processStartedAt = performance.now();

/**
 * Answers the connect-to-server screen's probe.
 *
 * Unauthenticated on purpose: a client has to be able to confirm it is pointed
 * at a real LazyProjectManager install before it has any credentials to offer.
 * Nothing here reveals anything an unauthenticated caller should not see.
 */
export const healthQueryHandler = defineQueryHandler({
  definition: healthQuery,
  requiresAuthentication: false,

  async execute(_params, context): Promise<HealthView> {
    const [dependencies, install] = await Promise.all([
      measureDependencies(context),
      readInstallIdentity(context),
    ]);

    return {
      status: dependencies.every((dependency) => dependency.reachable) ? 'ok' : 'degraded',
      serverName: install.serverName,
      version: readPackageVersion(),
      uptimeSeconds: Math.round((performance.now() - processStartedAt) / 1000),
      setupCompleted: install.setupCompleted,
      dependencies,
    };
  },
});

function measureDependencies(context: RequestContext): Promise<DependencyHealth[]> {
  return Promise.all([measurePostgres(context), measureRedis(context)]);
}

async function measurePostgres(context: RequestContext): Promise<DependencyHealth> {
  const probe = await measureDatabaseHealth(context.database);
  return { name: 'postgres', ...probe };
}

async function measureRedis(context: RequestContext): Promise<DependencyHealth> {
  const startedAt = performance.now();

  try {
    await context.redis.ping();
    return { name: 'redis', reachable: true, latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return {
      name: 'redis',
      reachable: false,
      latencyMs: Math.round(performance.now() - startedAt),
      detail: error instanceof Error ? error.message : 'Unknown Redis error',
    };
  }
}

/**
 * How this install identifies itself on the connect and sign-in screens.
 *
 * Once setup has run, the name the operator chose wins over the `SERVER_NAME`
 * environment variable — otherwise the sign-in panel would greet them with a
 * generic default rather than their own studio's name. `SERVER_NAME` is the
 * fallback for an install that has not been set up yet and has no name to show.
 *
 * A database that is unreachable reports "not set up" rather than failing the
 * whole probe, so the connect screen can still say the server is alive but
 * unhealthy instead of showing nothing at all.
 */
async function readInstallIdentity(
  context: RequestContext,
): Promise<{ serverName: string; setupCompleted: boolean }> {
  const fallbackName = context.environment.SERVER_NAME;

  try {
    const settings = await context.database
      .selectFrom('installSettings')
      .select(['serverName', 'setupCompletedAt'])
      .executeTakeFirst();

    if (settings === undefined) {
      return { serverName: fallbackName, setupCompleted: false };
    }

    return {
      serverName: settings.serverName,
      setupCompleted: settings.setupCompletedAt !== null,
    };
  } catch {
    return { serverName: fallbackName, setupCompleted: false };
  }
}

/**
 * Which build this is.
 *
 * `APP_VERSION` is stamped into the image from the git tag. It is not read from
 * package.json: `npm_package_version` is only set when Node is started through a
 * package script, and the container starts it directly, so that route reported a
 * hardcoded string for every release.
 */
function readPackageVersion(): string {
  return process.env.APP_VERSION ?? '0.0.0-dev';
}
