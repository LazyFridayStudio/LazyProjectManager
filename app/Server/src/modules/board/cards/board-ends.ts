import type { DatabaseTransaction } from '@lpm/database';

import { InvariantViolatedError } from '../../../domain/index.js';

/** A list, as both ends of a board need to read it. */
export interface BoardList {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

/** Where a card goes on, where it goes when finished, and every list between. */
export interface BoardEnds {
  readonly arriving: string;
  readonly finished: string;
  readonly lists: readonly BoardList[];
}

/**
 * The two ends of a board.
 *
 * The first and the last by position, which is how a board is read: work arrives
 * on the left and finishes on the right. By position rather than by name, so a
 * studio that calls its last column Shipped keeps the behaviour they can see
 * rather than the one a string match guessed at.
 *
 * Shared by the sync and by `board.moveCard` because closing is a move, and two
 * readings of which list means finished are two answers to the same question —
 * see `closingStampFor`.
 */
export async function readBoardEnds(
  database: DatabaseTransaction,
  projectId: string,
): Promise<BoardEnds> {
  const lists = await database
    .selectFrom('list')
    .innerJoin('board', 'board.id', 'list.boardId')
    .select(['list.id', 'list.name', 'list.color'])
    .where('board.projectId', '=', projectId)
    .where('list.archivedAt', 'is', null)
    .orderBy('list.position')
    .execute();

  const arriving = lists[0]?.id;
  const finished = lists.at(-1)?.id;

  if (arriving === undefined || finished === undefined) {
    // A board with every list archived. Nothing to put a card on, and inventing
    // a list to hold them would be this deciding what somebody's board is.
    throw new InvariantViolatedError(
      'This board has no lists to put issues on. Add one and try again.',
    );
  }

  return { arriving, finished, lists };
}
