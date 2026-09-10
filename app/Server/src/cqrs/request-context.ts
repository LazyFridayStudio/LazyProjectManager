import type { PermissionRule } from '../domain/index.js';
import type { Database } from '@lpm/database';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';

import type { SessionCookieWriter } from '../modules/identity/sessions/session-cookie.js';
import type { ObjectStore } from '../storage/index.js';
import type { FetchLike } from '../modules/scm/forge/github-app.js';
import type { Environment } from '../server/environment.js';

/**
 * Everything a handler is allowed to reach for.
 *
 * Handlers receive this rather than importing a module-level singleton, which is
 * what makes them testable against a throwaway database without a running
 * server. Nothing here is a Fastify type: `sessionCookie` and `origin` are the
 * narrow slices of the request a handler legitimately needs, expressed so the
 * handler never has to know HTTP exists.
 */
export interface RequestContext {
  readonly database: Database;
  readonly redis: Redis;
  /** Where files live. The API signs URLs for it and never handles bytes. */
  readonly storage: ObjectStore;
  /**
   * How this process reaches anything outside itself.
   *
   * On the context rather than reached for globally so a test can answer for
   * the forge without a network, the same way `storage` answers for the store.
   */
  readonly fetch: FetchLike;
  readonly environment: Environment;
  readonly logger: FastifyBaseLogger;
  /** The signed-in user, or null on the unauthenticated routes. */
  readonly actor: RequestActor | null;
  readonly sessionCookie: SessionCookieWriter;
  /** The session token presented on this request, needed to revoke it. */
  readonly sessionToken: string | null;
  readonly origin: RequestOrigin;
}

export interface RequestActor {
  readonly userId: string;
  readonly accountId: string;
  /**
   * Every permission rule reaching this person, resolved once when the session
   * was, so the hundred and ninety places that ask whether something is
   * permitted do not each have to fetch it.
   */
  readonly rules?: readonly PermissionRule[];
}

/** Recorded on a session so a user can recognise their own devices later. */
export interface RequestOrigin {
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
}

/**
 * The actor, insisted upon.
 *
 * Handlers default to `requiresAuthentication`, so the route has already turned
 * an anonymous caller away by the time this runs. It satisfies the type, and it
 * would catch a future change that opened a handler up without meaning to.
 */
export function requireActor(context: RequestContext, handlerName: string): RequestActor {
  if (context.actor === null) {
    throw new Error(`${handlerName} reached without an actor.`);
  }

  return context.actor;
}
