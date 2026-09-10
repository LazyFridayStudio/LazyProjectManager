import type { CommandDefinition, CommandEnvelope, CommandSuccess } from '@lpm/shared';
import type { z } from 'zod';

import type { RequestContext } from './request-context.js';

/**
 * A command handler.
 *
 * It loads an aggregate, enforces invariants from `src/domain`, writes, and
 * appends its events to `domain_event` — all inside one transaction. It returns
 * identifiers and nothing else; the client refetches the query it cares about
 * once the invalidation frame arrives.
 */
export interface CommandHandler<TDefinition extends CommandDefinition = CommandDefinition> {
  readonly definition: TDefinition;
  /**
   * `input` carries the envelope as well as the command's own fields, because
   * the route validates both together. `commandId` is what a handler passes to
   * `executeCommand` to make a retry a no-op.
   */
  execute(
    input: z.infer<TDefinition['inputSchema']> & CommandEnvelope,
    context: RequestContext,
  ): Promise<CommandSuccess>;
  /** When false, the route accepts requests without a session. Defaults to true. */
  readonly requiresAuthentication?: boolean;
}

export function defineCommandHandler<TDefinition extends CommandDefinition>(
  handler: CommandHandler<TDefinition>,
): CommandHandler<TDefinition> {
  return handler;
}

export function createCommandRegistry(
  handlers: readonly CommandHandler[],
): ReadonlyMap<string, CommandHandler> {
  const registry = new Map<string, CommandHandler>();

  for (const handler of handlers) {
    const { name } = handler.definition;

    if (registry.has(name)) {
      throw new Error(`Duplicate command handler registered for "${name}".`);
    }

    registry.set(name, handler);
  }

  return registry;
}
