import type { DatabaseTransaction } from '@lpm/database';

import { placeAmong, type PlacedRow } from '../../../domain/index.js';

export interface ListPlacement {
  readonly transaction: DatabaseTransaction;
  readonly boardId: string;
  /** The list being placed, excluded from its own neighbour search. */
  readonly listId: string;
  /** The list it should end up in front of. */
  readonly beforeListId: string | null | undefined;
  /** The list it should end up behind. */
  readonly afterListId: string | null | undefined;
}

/**
 * Works out where a list lands on its board, and spreads the board out first if
 * the gap has closed.
 *
 * The whole board is read in one statement and the arithmetic happens in
 * `placeAmong`, where `placeCard` asks the database for each neighbour in turn.
 * A list has thousands of cards in it and a board has a handful of lists, so
 * reading them all costs nothing and says what it is doing in one place.
 */
export async function placeList(placement: ListPlacement): Promise<number> {
  const others = (await listsOnBoard(placement)).filter((list) => list.id !== placement.listId);
  const landing = placeAmong(others, {
    before: placement.beforeListId,
    after: placement.afterListId,
  });

  for (const list of landing.spread) {
    await placement.transaction
      .updateTable('list')
      .set({ position: list.position })
      .where('id', '=', list.id)
      .execute();
  }

  return landing.position;
}

/** Every list still on the board, in the order the board draws them. */
async function listsOnBoard(placement: ListPlacement): Promise<PlacedRow[]> {
  const rows = await placement.transaction
    .selectFrom('list')
    .select(['id', 'position'])
    .where('boardId', '=', placement.boardId)
    .where('archivedAt', 'is', null)
    .orderBy('position')
    .execute();

  // `numeric` arrives from `pg` as a string, so every read goes through here.
  return rows.map((row) => ({ id: row.id, position: Number(row.position) }));
}
