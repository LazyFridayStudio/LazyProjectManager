import { defineCommand, defineQuery } from '@lpm/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerErrorHandler } from '../server/error-handler.js';
import { createCommandRegistry, defineCommandHandler } from './command-registry.js';
import { createQueryRegistry, defineQueryHandler } from './query-registry.js';
import { registerCqrsRoutes } from './register-cqrs-routes.js';
import type { RequestContext } from './request-context.js';

const openQuery = defineQuery(
  'test.open',
  z.object({ subject: z.string() }),
  z.object({ greeting: z.string() }),
);

const guardedQuery = defineQuery('test.guarded', z.object({}), z.object({ secret: z.string() }));

const guardedCommand = defineCommand('test.doThing', z.object({ label: z.string() }));
const openCommand = defineCommand('test.doOpenThing', z.object({ label: z.string() }));

const openQueryHandler = defineQueryHandler({
  definition: openQuery,
  requiresAuthentication: false,
  execute: (params) => Promise.resolve({ greeting: `hello ${params.subject}` }),
});

const guardedQueryHandler = defineQueryHandler({
  definition: guardedQuery,
  execute: () => Promise.resolve({ secret: 'only for members' }),
});

const guardedCommandHandler = defineCommandHandler({
  definition: guardedCommand,
  execute: () => Promise.resolve({ ok: true as const, id: '00000000-0000-4000-8000-000000000001' }),
});

const openCommandHandler = defineCommandHandler({
  definition: openCommand,
  requiresAuthentication: false,
  execute: () => Promise.resolve({ ok: true as const, id: '00000000-0000-4000-8000-000000000002' }),
});

/** A context with no signed-in actor, exercising the closed-by-default path. */
function createAnonymousContext(): Promise<RequestContext> {
  return Promise.resolve({ actor: null } as unknown as RequestContext);
}

describe('GIVEN the two routes the whole API is served through', () => {
  let server: FastifyInstance;

  beforeEach(() => {
    server = Fastify({ logger: false });
    registerErrorHandler(server);
    registerCqrsRoutes(server, {
      queries: createQueryRegistry([openQueryHandler, guardedQueryHandler]),
      commands: createCommandRegistry([guardedCommandHandler, openCommandHandler]),
      createContext: createAnonymousContext,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  describe('WHEN a query is requested with valid parameters', () => {
    it('THEN the view is wrapped in an envelope carrying an etag', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/test.open?subject=world',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ok: true,
        etag: expect.any(String) as unknown,
        data: { greeting: 'hello world' },
      });
    });

    it('THEN the same etag is on the header, so a proxy can cache on it', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/test.open?subject=world',
      });

      expect(response.headers.etag).toBe(response.json<{ etag: string }>().etag);
    });
  });

  describe('WHEN the client already holds the view', () => {
    it('THEN it answers 304 with no body', async () => {
      const first = await server.inject({ method: 'GET', url: '/api/q/test.open?subject=world' });

      const second = await server.inject({
        method: 'GET',
        url: '/api/q/test.open?subject=world',
        headers: { 'if-none-match': String(first.headers.etag) },
      });

      expect(second.statusCode).toBe(304);
      expect(second.body).toBe('');
    });
  });

  describe('WHEN query parameters fail the contract schema', () => {
    it('THEN it fails with VALIDATION_FAILED naming the field', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/q/test.open' });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        ok: false,
        code: 'VALIDATION_FAILED',
        fields: { subject: expect.any(String) as unknown },
      });
    });
  });

  describe('WHEN a handler says nothing about authentication', () => {
    it('THEN it is closed, so forgetting to opt in cannot expose it', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/q/test.guarded' });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    });
  });

  describe('WHEN an unknown query name is requested', () => {
    it('THEN it answers a typed NOT_FOUND rather than a bare 404 page', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/q/board.nope' });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    });
  });

  describe('WHEN an unknown command name is posted', () => {
    it('THEN it answers a typed NOT_FOUND', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/c/board.nope',
        payload: { commandId: '00000000-0000-4000-8000-0000000000ff' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    });
  });

  describe('WHEN a command arrives without the envelope', () => {
    it('THEN it is refused, because retries would stop being idempotent', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/c/test.doOpenThing',
        payload: { label: 'no envelope' },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        ok: false,
        code: 'VALIDATION_FAILED',
        fields: { commandId: expect.any(String) as unknown },
      });
    });
  });

  describe('WHEN a command arrives complete', () => {
    it('THEN it returns identifiers only, never a view model', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/c/test.doOpenThing',
        payload: { commandId: '00000000-0000-4000-8000-0000000000ff', label: 'with envelope' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true, id: '00000000-0000-4000-8000-000000000002' });
    });
  });

  describe('WHEN an anonymous caller posts to a guarded command', () => {
    it('THEN the session is checked before the body is validated', async () => {
      // Checking auth first means probing a command teaches an anonymous caller
      // nothing about its input shape.
      const response = await server.inject({
        method: 'POST',
        url: '/api/c/test.doThing',
        payload: { label: 'no envelope' },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    });
  });
});

describe('GIVEN a registry being assembled', () => {
  describe('WHEN two handlers claim the same query name', () => {
    it('THEN it throws, rather than letting the later one silently win', () => {
      expect(() => createQueryRegistry([openQueryHandler, openQueryHandler])).toThrow(
        /Duplicate query handler/,
      );
    });
  });

  describe('WHEN two handlers claim the same command name', () => {
    it('THEN it throws for the same reason', () => {
      expect(() => createCommandRegistry([openCommandHandler, openCommandHandler])).toThrow(
        /Duplicate command handler/,
      );
    });
  });
});
