import { z } from 'zod';

import { failureSchema } from './failure.js';

/**
 * The wire description of one query.
 *
 * A query is read-only, runs outside a transaction, and returns a view model
 * shaped for exactly one screen. `viewSchema` is what the client parses, so a
 * server that starts returning a different shape fails loudly at the boundary
 * rather than rendering `undefined` three components deep.
 */
export interface QueryDefinition<
  TName extends string = string,
  TParamsSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TViewSchema extends z.ZodTypeAny = z.ZodTypeAny,
> {
  readonly name: TName;
  readonly paramsSchema: TParamsSchema;
  readonly viewSchema: TViewSchema;
}

/**
 * What a caller supplies, which is not always what the handler receives.
 *
 * `z.input` rather than `z.infer`: a parameter that arrives as `modular,act-1`
 * and reaches the handler as two strings has two types, and the caller's is the
 * one written on the wire. For every schema without a transform the two are the
 * same type, which is why this went unnoticed until one had one.
 */
export type QueryParams<TDefinition extends QueryDefinition> = z.input<TDefinition['paramsSchema']>;

/**
 * What a handler is given: the parameters after the schema has read them.
 *
 * The counterpart to `QueryParams`. The route parses before dispatching, so a
 * handler never sees the string a browser sent.
 */
export type ParsedQueryParams<TDefinition extends QueryDefinition> = z.output<
  TDefinition['paramsSchema']
>;

export type QueryView<TDefinition extends QueryDefinition> = z.infer<TDefinition['viewSchema']>;

/**
 * Declares a query.
 *
 * The name is the URL segment: `defineQuery('board.view', …)` is served at
 * `GET /api/q/board.view`. Parameters arrive as a query string, so
 * `paramsSchema` should coerce — `z.coerce.number()`, not `z.number()`.
 */
export function defineQuery<
  TName extends string,
  TParamsSchema extends z.ZodTypeAny,
  TViewSchema extends z.ZodTypeAny,
>(
  name: TName,
  paramsSchema: TParamsSchema,
  viewSchema: TViewSchema,
): QueryDefinition<TName, TParamsSchema, TViewSchema> {
  return { name, paramsSchema, viewSchema };
}

/**
 * Builds the success envelope schema for a query.
 *
 * `etag` lets the client send `If-None-Match` and lets the server answer 304,
 * which matters most for the board view — it is refetched on every WebSocket
 * invalidation and is the largest payload in the app.
 */
export function createQuerySuccessSchema<TViewSchema extends z.ZodTypeAny>(
  viewSchema: TViewSchema,
): z.ZodObject<{ ok: z.ZodLiteral<true>; etag: z.ZodString; data: TViewSchema }> {
  return z.object({
    ok: z.literal(true),
    etag: z.string(),
    data: viewSchema,
  });
}

export function createQueryResultSchema(viewSchema: z.ZodTypeAny): z.ZodTypeAny {
  return z.union([createQuerySuccessSchema(viewSchema), failureSchema]);
}

export interface QuerySuccess<TView> {
  readonly ok: true;
  readonly etag: string;
  readonly data: TView;
}

export function createQuerySuccess<TView>(etag: string, data: TView): QuerySuccess<TView> {
  return { ok: true, etag, data };
}
