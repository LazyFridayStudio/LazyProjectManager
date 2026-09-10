import type { ParsedQueryParams, QueryDefinition, QueryView } from '@lpm/shared';

import type { RequestContext } from './request-context.js';

/**
 * A query handler: read-only, no transaction, no domain objects. Parameters in,
 * a view model shaped for exactly one screen out.
 */
export interface QueryHandler<TDefinition extends QueryDefinition = QueryDefinition> {
  readonly definition: TDefinition;
  execute(
    params: ParsedQueryParams<TDefinition>,
    context: RequestContext,
  ): Promise<QueryView<TDefinition>>;
  /** When false, the route rejects requests without a session. Defaults to true. */
  readonly requiresAuthentication?: boolean;
}

export function defineQueryHandler<TDefinition extends QueryDefinition>(
  handler: QueryHandler<TDefinition>,
): QueryHandler<TDefinition> {
  return handler;
}

/**
 * Builds the name-to-handler lookup the query route dispatches through.
 *
 * Throws on a duplicate name rather than letting the later registration silently
 * win, because two handlers answering `board.view` is the kind of bug that only
 * shows up as the wrong data on someone's screen.
 */
export function createQueryRegistry(
  handlers: readonly QueryHandler[],
): ReadonlyMap<string, QueryHandler> {
  const registry = new Map<string, QueryHandler>();

  for (const handler of handlers) {
    const { name } = handler.definition;

    if (registry.has(name)) {
      throw new Error(`Duplicate query handler registered for "${name}".`);
    }

    registry.set(name, handler);
  }

  return registry;
}
