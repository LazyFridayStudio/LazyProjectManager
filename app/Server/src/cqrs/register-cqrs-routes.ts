import {
  createFailure,
  createQuerySuccess,
  getCommandRequestSchema,
  type CommandResult,
  type Failure,
} from '@lpm/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { getHttpStatusForFailure } from '../server/error-handler.js';
import type { CommandHandler } from './command-registry.js';
import { computeEtag, matchesClientEtag } from './compute-etag.js';
import type { QueryHandler } from './query-registry.js';
import type { RequestContext } from './request-context.js';

const QUERY_ROUTE = '/api/q/:queryName';
const COMMAND_ROUTE = '/api/c/:commandName';
const NOT_MODIFIED = 304;

export interface CqrsRouteOptions {
  readonly queries: ReadonlyMap<string, QueryHandler>;
  readonly commands: ReadonlyMap<string, CommandHandler>;
  /**
   * Builds the per-request context. Called once per request, before dispatch.
   * Asynchronous because resolving the actor means a session lookup.
   */
  readonly createContext: (request: FastifyRequest, reply: FastifyReply) => Promise<RequestContext>;
}

/**
 * Mounts the two routes the whole API is served through.
 *
 * `GET /api/q/:queryName` and `POST /api/c/:commandName`, exactly as `API.md`
 * describes. Adding a feature means registering a handler, never touching this
 * file.
 */
export function registerCqrsRoutes(server: FastifyInstance, options: CqrsRouteOptions): void {
  server.get(QUERY_ROUTE, async (request, reply) => {
    const queryName = (request.params as { queryName: string }).queryName;
    const handler = options.queries.get(queryName);

    if (handler === undefined) {
      return sendFailure(reply, createFailure('NOT_FOUND', `Unknown query "${queryName}".`));
    }

    const context = await options.createContext(request, reply);
    const denial = denyWhenAuthenticationMissing(handler.requiresAuthentication, context);

    if (denial !== null) {
      return sendFailure(reply, denial);
    }

    const params = handler.definition.paramsSchema.parse(request.query) as unknown;
    // The registry is keyed by name, so a handler's precise view type is not
    // knowable here. It was validated on the way in and is validated again by
    // the client against the same contract schema.
    const view: unknown = await handler.execute(params, context);
    const etag = computeEtag(view);

    if (matchesClientEtag(request.headers['if-none-match'], etag)) {
      return reply.status(NOT_MODIFIED).send();
    }

    return reply.header('etag', etag).send(createQuerySuccess(etag, view));
  });

  server.post(COMMAND_ROUTE, async (request, reply) => {
    const commandName = (request.params as { commandName: string }).commandName;
    const handler = options.commands.get(commandName);

    if (handler === undefined) {
      return sendFailure(reply, createFailure('NOT_FOUND', `Unknown command "${commandName}".`));
    }

    const context = await options.createContext(request, reply);
    const denial = denyWhenAuthenticationMissing(handler.requiresAuthentication, context);

    if (denial !== null) {
      return sendFailure(reply, denial);
    }

    const input = getCommandRequestSchema(handler.definition).parse(request.body) as unknown;
    const result: CommandResult = await handler.execute(input, context);

    return reply.send(result);
  });
}

/**
 * Handlers are authenticated unless they opt out, so a new handler that forgets
 * to say anything is closed rather than open.
 */
function denyWhenAuthenticationMissing(
  requiresAuthentication: boolean | undefined,
  context: RequestContext,
): Failure | null {
  if (requiresAuthentication === false || context.actor !== null) {
    return null;
  }

  return createFailure('UNAUTHENTICATED', 'Sign in to continue.');
}

function sendFailure(reply: FastifyReply, failure: Failure): FastifyReply {
  return reply.status(getHttpStatusForFailure(failure.code)).send(failure);
}
