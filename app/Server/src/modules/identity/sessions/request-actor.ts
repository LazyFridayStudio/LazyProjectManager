import type { Database } from '@lpm/database';
import type { FastifyRequest } from 'fastify';

import type { RequestActor } from '../../../cqrs/request-context.js';
import { findActorForApiToken, readApiToken } from './api-token-store.js';
import { readSessionToken } from './session-cookie.js';
import { findActorForSessionToken } from './session-store.js';

/**
 * Who is asking: a program with a key, or a browser with a session.
 *
 * The key wins when both are there, and that is the deliberate part. A cookie
 * is *ambient* — the browser attaches it to every request whether or not
 * anybody meant it to, which is the whole reason CSRF is a category of bug. An
 * `Authorization` header is not ambient: something had to decide to set it. So
 * when a request carries both, the one that was chosen on purpose is the one
 * that was meant.
 *
 * It also makes the obvious thing work. A script run from a signed-in browser's
 * context — a devtools console, a test driving the page — presents its key and
 * gets the agent, rather than quietly acting as whoever happens to be signed in
 * on that machine. The e2e caught exactly that: the request came back as Jake.
 *
 * A key that resolves to nobody is refused rather than falling back to the
 * cookie, which is the same argument arrived at from the other side: a program
 * that presented a revoked key meant to act as itself, and answering as the
 * person whose browser it happens to be running in is the thing this ordering
 * exists to prevent.
 *
 * What comes back is a `RequestActor` either way, and nothing downstream can
 * tell the difference. That is also deliberate: an agent's permissions are
 * permissions, and every one of the two hundred places that asks whether
 * something is allowed keeps working without knowing agents exist.
 *
 * Every authenticated door in the process comes through here. There was a
 * second copy of this in `register-file-routes`, under the same name and
 * reading the cookie only, so an agent could be granted somewhere to put a file
 * and then refused when it sent the bytes — leaving a pending row nothing would
 * ever finish (#253). Two functions called `findActor` is how that survived
 * being read. `/ws` is the one door that stays cookie-only, and says why.
 */
export async function findActorForRequest(
  database: Database,
  request: FastifyRequest,
): Promise<RequestActor | null> {
  const apiToken = readApiToken(request);

  if (apiToken !== null) {
    return findActorForApiToken(database, apiToken);
  }

  const sessionToken = readSessionToken(request);

  return sessionToken === null ? null : findActorForSessionToken(database, sessionToken);
}
