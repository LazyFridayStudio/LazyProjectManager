import { getSessionLifetimeSeconds } from '../../../domain/index.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const SESSION_COOKIE_NAME = 'lpm_session';

/**
 * Writes and clears the session cookie.
 *
 * Handlers receive this rather than a `FastifyReply`, so a command stays free of
 * HTTP types and can be tested without a request.
 */
export interface SessionCookieWriter {
  issue(token: string): void;
  clear(): void;
}

/**
 * Cookie attributes.
 *
 * `httpOnly` keeps the token out of reach of any script on the page, so an XSS
 * bug cannot exfiltrate a session. `sameSite: lax` blocks it from riding along
 * on cross-site form posts while still surviving a normal link into the app.
 * `secure` follows the request's own protocol so development over plain http
 * works, while an install behind a Cloudflare tunnel — where `request.protocol`
 * reads https from the forwarded headers — gets a secure cookie.
 */
function buildCookieOptions(request: FastifyRequest): {
  path: string;
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
} {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: request.protocol === 'https',
  };
}

export function createSessionCookieWriter(
  request: FastifyRequest,
  reply: FastifyReply,
): SessionCookieWriter {
  return {
    issue(token) {
      void reply.setCookie(SESSION_COOKIE_NAME, token, {
        ...buildCookieOptions(request),
        maxAge: getSessionLifetimeSeconds(),
      });
    },
    clear() {
      void reply.clearCookie(SESSION_COOKIE_NAME, buildCookieOptions(request));
    },
  };
}

export function readSessionToken(request: FastifyRequest): string | null {
  const token = request.cookies[SESSION_COOKIE_NAME];
  return token === undefined || token === '' ? null : token;
}
