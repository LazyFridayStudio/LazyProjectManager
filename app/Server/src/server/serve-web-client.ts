import { sep } from 'node:path';

import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Paths the API owns. A request for one of these is never answered with the
 * single-page app's HTML, so a typo in a query name returns a JSON failure the
 * client can read rather than a page of markup it will fail to parse.
 */
const API_PATH_PREFIXES = ['/api/', '/health', '/webhooks/'];

/** Hashed asset filenames are immutable, so they can be cached indefinitely. */
const IMMUTABLE_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** index.html must never be cached, or a deploy is invisible until a hard reload. */
const HTML_CACHE_CONTROL = 'no-cache';

/**
 * Everything named by hand rather than by a build.
 *
 * `icon.svg` is the one of these today, and it is the reason this exists: a
 * name that stays the same while the file behind it changes cannot be promised
 * to a browser for a year. `immutable` is a promise browsers keep hard — a new
 * mark would never have reached anybody already carrying the old one.
 *
 * An hour, so a change lands the same afternoon without a tab reopening asking
 * for it again.
 */
const NAMED_ASSET_CACHE_CONTROL = 'public, max-age=3600';

/** Where a build puts the files it hashed. Anything outside it, a person named. */
const HASHED_ASSET_DIRECTORY = 'assets';

/**
 * Serves the built web client from the API process.
 *
 * This is what lets a studio run one container and get the whole product. It
 * also means the browser and the API share an origin, so there is no CORS
 * configuration to get wrong and nothing to special-case when the install sits
 * behind a Cloudflare tunnel.
 */
export async function serveWebClient(server: FastifyInstance, webRoot: string): Promise<void> {
  await server.register(fastifyStatic, {
    root: webRoot,
    // The SPA fallback below handles unmatched paths; letting the static plugin
    // answer 404 first would pre-empt it.
    wildcard: false,
    // The plugin's own cache-control default (`public, max-age=0`) is applied
    // after setHeaders and would overwrite the values below. Turning it off
    // leaves setHeaders as the single place caching is decided.
    cacheControl: false,
    setHeaders(reply, filePath) {
      reply.header('cache-control', cacheControlFor(filePath));
    },
  });

  server.setNotFoundHandler(handleUnmatchedRoute);
}

/**
 * How long the browser may keep this file, decided by how its name was chosen.
 *
 * The shell never, a hashed file forever, and a file somebody named for an hour.
 * Three answers because there are three kinds of name, not because there are
 * three kinds of file.
 */
function cacheControlFor(filePath: string): string {
  if (filePath.endsWith('.html')) {
    return HTML_CACHE_CONTROL;
  }

  return filePath.includes(`${sep}${HASHED_ASSET_DIRECTORY}${sep}`)
    ? IMMUTABLE_ASSET_CACHE_CONTROL
    : NAMED_ASSET_CACHE_CONTROL;
}

/**
 * Client-side routing means the browser can ask for `/projects/abc` directly.
 * That path exists only in the React router, so the server answers with the app
 * shell and lets the client resolve it — except under an API prefix, where a
 * miss is a genuine 404.
 */
function handleUnmatchedRoute(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (isApiPath(request.url)) {
    return reply.status(404).send({
      ok: false,
      code: 'NOT_FOUND',
      message: `No route for ${request.method} ${request.url}.`,
    });
  }

  // `setHeaders` above applies the no-cache directive; sendFile routes through it.
  return reply.sendFile('index.html');
}

function isApiPath(url: string): boolean {
  return API_PATH_PREFIXES.some((prefix) => url.startsWith(prefix));
}
