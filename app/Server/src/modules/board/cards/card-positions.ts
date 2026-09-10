import type { DatabaseTransaction } from '@lpm/database';

import { placeAtEnd, placeInOrder, type OrderedRows } from '../../../ordering/place-in-order.js';

export interface CardPlacement {
  readonly transaction: DatabaseTransaction;
  readonly listId: string;
  /** The card being placed, excluded from its own neighbour search. */
  readonly cardId: string | null;
  /** The card it should end up above. */
  readonly beforeCardId: string | null | undefined;
  /** The card it should end up below. */
  readonly afterCardId: string | null | undefined;
}

/**
 * The cards of one list, as the ordering algorithm asks about them.
 *
 * The arithmetic itself lives in `ordering/place-in-order`, because assets in a
 * category want exactly the same of it and two copies would come to disagree.
 * What is here is the half that is about cards: which table, which column holds
 * the list, and that the card being moved is not its own neighbour.
 */
function cardsInList(placement: CardPlacement): OrderedRows {
  const { transaction, listId } = placement;

  const others = () => {
    const query = transaction.selectFrom('card').where('listId', '=', listId);

    return placement.cardId === null ? query : query.where('id', '!=', placement.cardId);
  };

  return {
    async positionOf(id) {
      const card = await transaction
        .selectFrom('card')
        .select('position')
        .where('id', '=', id)
        .where('listId', '=', listId)
        .executeTakeFirst();

      return readPosition(card?.position);
    },

    async firstAbove(position) {
      const row = await others()
        .select(({ fn }) => fn.min('position').as('found'))
        // Sent as text: `position` is `numeric`, which Postgres compares exactly
        // and JavaScript would have already rounded.
        .where('position', '>', String(position))
        .executeTakeFirst();

      return readPosition(row?.found);
    },

    async lastBelow(position) {
      const row = await others()
        .select(({ fn }) => fn.max('position').as('found'))
        .where('position', '<', String(position))
        .executeTakeFirst();

      return readPosition(row?.found);
    },

    async last() {
      const row = await others()
        .select(({ fn }) => fn.max('position').as('found'))
        .executeTakeFirst();

      return readPosition(row?.found);
    },

    async idsInOrder() {
      const cards = await transaction
        .selectFrom('card')
        .select('id')
        .where('listId', '=', listId)
        .orderBy('position')
        .execute();

      return cards.map((card) => card.id);
    },

    async setPosition(id, position) {
      await transaction.updateTable('card').set({ position }).where('id', '=', id).execute();
    },
  };
}

/**
 * Works out where a card lands.
 *
 * Neighbours rather than an index, because an index means something different by
 * the time it arrives — somebody else may have dropped a card above it. Naming
 * the cards it should sit between is a request that still makes sense when the
 * list has moved on.
 */
export async function placeCard(placement: CardPlacement): Promise<number> {
  return placeInOrder(cardsInList(placement), {
    beforeId: placement.beforeCardId,
    afterId: placement.afterCardId,
  });
}

/** Where a brand-new card goes: the end of its list. */
export async function placeAtEndOfList(
  transaction: DatabaseTransaction,
  listId: string,
): Promise<number> {
  return placeAtEnd(
    cardsInList({ transaction, listId, cardId: null, beforeCardId: null, afterCardId: null }),
  );
}

/** `numeric` arrives from `pg` as a string, so every read goes through here. */
function readPosition(value: string | number | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}
