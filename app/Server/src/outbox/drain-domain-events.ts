import type { Database } from '@lpm/database';

/**
 * One unprocessed row from the transactional outbox.
 */
export interface DomainEventRecord {
  readonly id: string;
  readonly accountId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly name: string;
  readonly payload: Record<string, unknown>;
  readonly actorId: string | null;
  readonly occurredAt: Date;
}

/**
 * Reacts to one domain event.
 *
 * Consumers must be idempotent: a crash between handling an event and marking it
 * processed means the same event arrives again, and that is the normal case, not
 * an edge case.
 */
export interface DomainEventConsumer {
  readonly name: string;
  handle(event: DomainEventRecord): Promise<void>;
}

export interface DrainOptions {
  readonly database: Database;
  readonly consumers: readonly DomainEventConsumer[];
  /** Rows claimed per pass. Bounded so one large backlog cannot stall the loop. */
  readonly batchSize?: number;
  readonly onConsumerError?: (
    consumerName: string,
    event: DomainEventRecord,
    error: unknown,
  ) => void;
}

const DEFAULT_BATCH_SIZE = 100;

/**
 * Drains one batch of unprocessed events and returns how many were handled.
 *
 * Rows are claimed with `for update skip locked`, so running several workers is
 * safe: each claims a disjoint batch instead of contending on the same rows.
 */
export async function drainDomainEvents(options: DrainOptions): Promise<number> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  return options.database.transaction().execute(async (transaction) => {
    const events = await claimUnprocessedEvents(transaction, batchSize);

    if (events.length === 0) {
      return 0;
    }

    for (const event of events) {
      await fanOutToConsumers(event, options);
    }

    await markEventsProcessed(
      transaction,
      events.map((event) => event.id),
    );

    return events.length;
  });
}

async function claimUnprocessedEvents(
  transaction: Database,
  batchSize: number,
): Promise<DomainEventRecord[]> {
  const rows = await transaction
    .selectFrom('domainEvent')
    .selectAll()
    .where('processedAt', 'is', null)
    .orderBy('occurredAt', 'asc')
    .limit(batchSize)
    .forUpdate()
    .skipLocked()
    .execute();

  return rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    name: row.name,
    payload: row.payload,
    actorId: row.actorId,
    occurredAt: row.occurredAt,
  }));
}

/**
 * One failing consumer must not stop the others, and must not stop the batch:
 * the event is still marked processed, and the failure is reported. Blocking the
 * whole outbox on a single bad consumer is how a tracker stops updating.
 */
async function fanOutToConsumers(event: DomainEventRecord, options: DrainOptions): Promise<void> {
  for (const consumer of options.consumers) {
    try {
      await consumer.handle(event);
    } catch (error) {
      options.onConsumerError?.(consumer.name, event, error);
    }
  }
}

async function markEventsProcessed(
  transaction: Database,
  eventIds: readonly string[],
): Promise<void> {
  await transaction
    .updateTable('domainEvent')
    .set({ processedAt: new Date() })
    .where('id', 'in', [...eventIds])
    .execute();
}
