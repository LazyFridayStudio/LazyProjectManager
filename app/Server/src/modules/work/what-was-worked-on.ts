import type { Database } from '@lpm/database';

import { InvariantViolatedError } from '../../domain/index.js';

export interface WorkedOn {
  readonly kind: 'card' | 'asset';
  readonly id: string;
  readonly projectId: string;
  readonly accountId: string;
}

export interface WorkedOnRequest {
  readonly cardId?: string | undefined;
  readonly assetId?: string | undefined;
}

/**
 * Which card or asset an entry is about, and which project that puts it in.
 *
 * Exactly one, which the table also insists on: an entry about neither is about
 * nothing, and one about both would be counted twice by anything totalling
 * either.
 *
 * Read before the actor is authorised, because the project it belongs to is
 * what decides whether they may. Nothing about the thing is returned to the
 * caller — a request naming a card in another studio comes back as though the
 * card does not exist, which is what it is to them.
 *
 * A deleted card is not found, because deleting one moves it into the recovery
 * table rather than flagging it. Its entries went with it on the cascade.
 */
export async function findWhatWasWorkedOn(
  database: Database,
  request: WorkedOnRequest,
): Promise<WorkedOn> {
  const { cardId, assetId } = request;

  if ((cardId === undefined) === (assetId === undefined)) {
    throw new InvariantViolatedError('Work is logged against a card or an asset, not both.');
  }

  return cardId === undefined ? findAsset(database, assetId ?? '') : findCard(database, cardId);
}

async function findCard(database: Database, cardId: string): Promise<WorkedOn> {
  const card = await database
    .selectFrom('card')
    .select(['id', 'projectId', 'accountId'])
    .where('id', '=', cardId)
    .executeTakeFirst();

  if (card === undefined) {
    throw new InvariantViolatedError('That card is not there to log work against.');
  }

  return { kind: 'card', id: card.id, projectId: card.projectId, accountId: card.accountId };
}

async function findAsset(database: Database, assetId: string): Promise<WorkedOn> {
  const asset = await database
    .selectFrom('asset')
    .select(['id', 'projectId', 'accountId'])
    .where('id', '=', assetId)
    .executeTakeFirst();

  if (asset === undefined) {
    throw new InvariantViolatedError('That asset is not there to log work against.');
  }

  return { kind: 'asset', id: asset.id, projectId: asset.projectId, accountId: asset.accountId };
}
