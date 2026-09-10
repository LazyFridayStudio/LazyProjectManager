import { createSortableId, type Database, type DatabaseTransaction } from '@lpm/database';
import type { ScmProvider } from '@lpm/shared';

import { deliveryWantsASync } from './delivery-wants-a-sync.js';
import { findCardKeys } from './find-card-keys.js';
import { readDelivery, type DeliveredActivity } from './read-delivery.js';

/**
 * Reads the deliveries a repository has sent and puts them on the cards they
 * name.
 *
 * Its own queue rather than the outbox, because the two want different things.
 * The outbox drains a thing that happened; this drains a thing somebody said,
 * and the reading of it is a guess that may improve. `processed_at` is what
 * makes that recoverable: clear it and the whole history is read again by the
 * newer parser, against payloads that were never thrown away.
 *
 * Everything it knows comes out of the payload. The forge is never asked
 * anything, so a delivery is read at the speed of the database and a repository
 * that is slow or unreachable cannot hold the queue up.
 *
 * Every write is idempotent, because it has to be — a delivery may be read twice
 * after a crash, and the same commit is named again by every branch it lands on.
 */

/** Bounded so one enormous backlog cannot hold the loop for a whole cycle. */
const DEFAULT_BATCH_SIZE = 50;

export interface IngestOptions {
  readonly database: Database;
  readonly batchSize?: number;
  readonly onDeliveryError?: (deliveryId: string, error: unknown) => void;
}

interface ClaimedDelivery {
  readonly id: string;
  readonly connectionId: string;
  readonly accountId: string;
  readonly projectId: string;
  readonly projectCode: string;
  readonly provider: ScmProvider;
  readonly eventName: string;
  readonly payload: unknown;
}

/** Reads one batch and returns how many deliveries were dealt with. */
export async function ingestScmDeliveries(options: IngestOptions): Promise<number> {
  const deliveries = await claimDeliveries(
    options.database,
    options.batchSize ?? DEFAULT_BATCH_SIZE,
  );

  for (const delivery of deliveries) {
    try {
      await options.database
        .transaction()
        .execute((transaction) => recordDelivery(transaction, delivery));
    } catch (error) {
      // One delivery nobody can read must not stop the ones behind it. It stays
      // unprocessed, so a fix reaches it on the next pass.
      options.onDeliveryError?.(delivery.id, error);
    }
  }

  return deliveries.length;
}

/**
 * The deliveries waiting, with everything needed to read them.
 *
 * Locked and skipped rather than merely selected, so two workers drain the same
 * queue without both reading the same delivery.
 */
async function claimDeliveries(
  database: Database,
  batchSize: number,
): Promise<readonly ClaimedDelivery[]> {
  return database
    .selectFrom('scmEventRaw')
    .innerJoin('scmConnection', 'scmConnection.id', 'scmEventRaw.connectionId')
    .innerJoin('project', 'project.id', 'scmConnection.projectId')
    .select([
      'scmEventRaw.id',
      'scmEventRaw.connectionId',
      'scmEventRaw.eventName',
      'scmEventRaw.payload',
      'scmConnection.accountId',
      'scmConnection.provider',
      'scmConnection.projectId',
      'project.code as projectCode',
    ])
    .where('scmEventRaw.processedAt', 'is', null)
    .orderBy('scmEventRaw.receivedAt')
    .limit(batchSize)
    .forUpdate()
    .skipLocked()
    .execute();
}

async function recordDelivery(
  transaction: DatabaseTransaction,
  delivery: ClaimedDelivery,
): Promise<void> {
  const activities = readDelivery(delivery.provider, delivery.eventName, delivery.payload);
  const touched = new Set<string>();

  for (const activity of activities) {
    const cardIds = await resolveCards(transaction, delivery, activity);

    for (const cardId of cardIds) {
      await linkActivity({ transaction, delivery, activity, cardId });
      touched.add(cardId);
    }
  }

  for (const cardId of touched) {
    await announce(transaction, delivery, cardId);
  }

  /*
   * A delivery that says the issue list has moved brings the next reconcile
   * forward, from the half-hourly sweep to the worker's next pass.
   *
   * The time is written down rather than acted on: what a closed issue means
   * for a card is `syncProjectIssues`' answer and must stay its only one, or
   * the board grows a second opinion about where work goes. All this says is
   * that there is something to catch up with.
   */
  if (deliveryWantsASync(delivery.provider, delivery.eventName, delivery.payload)) {
    await transaction
      .updateTable('scmConnection')
      .set({ forgeSpokeAt: new Date() })
      .where('id', '=', delivery.connectionId)
      .execute();
  }

  await transaction
    .updateTable('scmEventRaw')
    .set({ processedAt: new Date() })
    .where('id', '=', delivery.id)
    .execute();
}

/**
 * The cards this activity names, in this project.
 *
 * A key that resolves to nothing is not an error and not worth a log line:
 * people write ticket numbers from memory, and one that turns out not to exist
 * is a typo, not a fault in the ingest.
 */
async function resolveCards(
  transaction: DatabaseTransaction,
  delivery: ClaimedDelivery,
  activity: DeliveredActivity,
): Promise<readonly string[]> {
  const keys = findCardKeys(activity.searchIn, delivery.projectCode);

  if (keys.length === 0) {
    return [];
  }

  const cards = await transaction
    .selectFrom('card')
    .select('id')
    .where('projectId', '=', delivery.projectId)
    .where('cardKey', 'in', [...keys])
    .execute();

  return cards.map((card) => card.id);
}

interface ActivityToLink {
  readonly transaction: DatabaseTransaction;
  readonly delivery: ClaimedDelivery;
  readonly activity: DeliveredActivity;
  readonly cardId: string;
}

function linkActivity({
  transaction,
  delivery,
  activity,
  cardId,
}: ActivityToLink): Promise<unknown> {
  return (
    transaction
      .insertInto('scmLink')
      .values({
        cardId,
        connectionId: delivery.connectionId,
        kind: activity.kind,
        ref: activity.ref,
        url: activity.url,
        author: activity.author,
        message: activity.message,
        occurredAt: activity.occurredAt,
      })
      // The same commit arrives again on a retry, and again on every branch it
      // is pushed to. What it says can change — a pull request is retitled — so
      // the newer reading wins.
      .onConflict((conflict) =>
        conflict.columns(['cardId', 'connectionId', 'kind', 'ref']).doUpdateSet({
          url: activity.url,
          author: activity.author,
          message: activity.message,
          occurredAt: activity.occurredAt,
        }),
      )
      .execute()
  );
}

/**
 * Tells anybody looking at the card that it has changed.
 *
 * Through the outbox rather than straight to Redis, so this goes out the same
 * way every other change does — and so it survives a worker that dies between
 * writing the link and publishing.
 */
function announce(
  transaction: DatabaseTransaction,
  delivery: ClaimedDelivery,
  cardId: string,
): Promise<unknown> {
  return transaction
    .insertInto('domainEvent')
    .values({
      // Time-ordered, as every event is: the drain reads them in the order they
      // happened rather than in whatever order a uuid falls in.
      id: createSortableId(),
      accountId: delivery.accountId,
      aggregateType: 'card',
      aggregateId: cardId,
      name: 'scm.linked',
      payload: JSON.stringify({ projectId: delivery.projectId }),
      actorId: null,
    })
    .execute();
}
