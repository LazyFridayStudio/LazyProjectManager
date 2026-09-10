import { createSortableId, type Database, type DatabaseTransaction } from '@lpm/database';

import { isUniqueViolation } from './unique-violation.js';

export interface DomainEventToAppend {
  readonly accountId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** Past tense, `module.thingHappened`, e.g. `identity.userSignedIn`. */
  readonly name: string;
  readonly payload: Record<string, unknown>;
}

/**
 * What a command handler is given inside its transaction.
 *
 * `appendEvent` collects; nothing is written until the handler returns, so an
 * event cannot outlive a rolled-back write.
 */
export interface CommandTransaction {
  readonly database: DatabaseTransaction;
  appendEvent(event: DomainEventToAppend): void;
}

export interface ExecuteCommandOptions<TResult> {
  readonly database: Database;
  readonly commandName: string;
  readonly commandId: string;
  readonly actorId: string | null;
  readonly run: (transaction: CommandTransaction) => Promise<TResult>;
}

export type CommandOutcome<TResult> =
  | { readonly applied: true; readonly result: TResult }
  /** This `commandId` was already processed. The write is not repeated. */
  | { readonly applied: false };

/**
 * Runs a command handler inside one transaction, together with its idempotency
 * record and the events it emitted.
 *
 * Three things commit or roll back as a unit: the row in `command_log` that
 * makes a retry a no-op, whatever state the handler changed, and the rows it
 * appended to `domain_event`. Splitting any of them across transactions is how
 * a tracker ends up with an event for a write that never happened, or a write
 * nothing downstream ever hears about.
 */
export async function executeCommand<TResult>(
  options: ExecuteCommandOptions<TResult>,
): Promise<CommandOutcome<TResult>> {
  try {
    return await options.database.transaction().execute(async (transaction) => {
      await recordCommand(transaction, options);

      const pendingEvents: DomainEventToAppend[] = [];
      const result = await options.run({
        database: transaction,
        appendEvent: (event) => pendingEvents.push(event),
      });

      await appendDomainEvents(transaction, pendingEvents, options.actorId);

      return { applied: true as const, result };
    });
  } catch (error) {
    if (isDuplicateCommand(error)) {
      return { applied: false };
    }

    throw error;
  }
}

/**
 * Claims the command id. A retry of the same request collides here, which is
 * what makes every command safe to send twice.
 */
async function recordCommand(
  transaction: DatabaseTransaction,
  options: ExecuteCommandOptions<unknown>,
): Promise<void> {
  await transaction
    .insertInto('commandLog')
    .values({
      commandId: options.commandId,
      name: options.commandName,
      actorId: options.actorId,
    })
    .execute();
}

async function appendDomainEvents(
  transaction: DatabaseTransaction,
  events: readonly DomainEventToAppend[],
  actorId: string | null,
): Promise<void> {
  if (events.length === 0) {
    return;
  }

  await transaction
    .insertInto('domainEvent')
    .values(
      events.map((event) => ({
        id: createSortableId(),
        accountId: event.accountId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        name: event.name,
        payload: JSON.stringify(event.payload),
        actorId,
      })),
    )
    .execute();
}

/**
 * A unique violation on `command_log`'s primary key means this exact command was
 * already applied. Any other unique violation is a genuine conflict the handler
 * should surface, so the constraint name is checked rather than the code alone.
 */
function isDuplicateCommand(error: unknown): boolean {
  return isUniqueViolation(error, 'command_log_pkey');
}
