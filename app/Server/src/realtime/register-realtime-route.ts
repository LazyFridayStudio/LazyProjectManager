// Imported for its module augmentation: it is what puts `websocket: true` on a
// route's options and hands the handler a socket.
import type {} from '@fastify/websocket';
import type { Database } from '@lpm/database';
import { watchFrameSchema } from '@lpm/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { findActorForSessionToken, readSessionToken } from '../modules/identity/index.js';
import { type InvalidationHub, type FrameSink } from './invalidation-hub.js';

export interface RealtimeRouteOptions {
  readonly database: Database;
  readonly hub: InvalidationHub;
}

/**
 * The socket a board listens on.
 *
 * Authenticated by the same session cookie as everything else — a WebSocket
 * carries the cookies of the page that opened it, so there is no second way in
 * to get wrong.
 *
 * It only ever says what went stale. Nothing about the change travels, so a
 * socket that has been open since before somebody's permissions changed cannot
 * leak anything they would now be refused.
 */
export function registerRealtimeRoute(
  server: FastifyInstance,
  options: RealtimeRouteOptions,
): void {
  server.get('/ws', { websocket: true }, (socket, request: FastifyRequest) => {
    const sink: FrameSink = {
      send: (payload) => {
        socket.send(payload);
      },
    };

    socket.on('close', () => {
      options.hub.forget(sink);
    });

    socket.on('message', (raw: Buffer) => {
      void handleMessage({ options, request, sink, raw }).catch(() => {
        // A socket that cannot be spoken to is closed rather than retried; the
        // browser reconnects on its own.
        socket.close();
      });
    });
  });
}

interface IncomingMessage {
  readonly options: RealtimeRouteOptions;
  readonly request: FastifyRequest;
  readonly sink: FrameSink;
  readonly raw: Buffer;
}

async function handleMessage({ options, request, sink, raw }: IncomingMessage): Promise<void> {
  const watch = watchFrameSchema.safeParse(readJson(raw.toString()));

  if (!watch.success) {
    return;
  }

  const token = readSessionToken(request);
  const actor = token === null ? null : await findActorForSessionToken(options.database, token);

  if (actor === null) {
    return;
  }

  // Checked on every watch rather than once at connect: a socket outlives the
  // membership that opened it, and this is the only place that would notice.
  const reachable = await canSeeProject(options.database, actor, watch.data.projectId);

  if (!reachable) {
    return;
  }

  await options.hub.watch({
    sink,
    accountId: actor.accountId,
    projectId: watch.data.projectId,
  });
}

async function canSeeProject(
  database: Database,
  actor: { userId: string; accountId: string },
  projectId: string,
): Promise<boolean> {
  const project = await database
    .selectFrom('project')
    .select('id')
    .where('id', '=', projectId)
    .where('accountId', '=', actor.accountId)
    .executeTakeFirst();

  return project !== undefined;
}

function readJson(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
