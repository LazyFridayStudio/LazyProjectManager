import type { CollisionDetection } from '@dnd-kit/core';
import { horizontalListSortingStrategy, type SortingStrategy } from '@dnd-kit/sortable';
import type { BoardView } from '@lpm/shared';

import { inDroppedOrder, resolveDrop, underThePointer } from '../dragging/index.js';

/**
 * The columns step aside for another column, and for nothing else.
 *
 * A column is in both of the board's sortable contexts: it is one of the things
 * that can be reordered, and it is where a card is dropped. The horizontal
 * strategy works from what the pointer is over without asking what is being
 * carried, so without this a card held over an empty list slides every column
 * to its left sideways by the width of the card.
 *
 * `activeIndex` is -1 when the thing being dragged is not one of these columns,
 * which is the whole of the question.
 */
export const columnsStepAside: SortingStrategy = (args) =>
  args.activeIndex === -1 ? null : horizontalListSortingStrategy(args);

/**
 * Where a dragged list should end up, expressed the way the command takes it.
 *
 * Neighbours rather than an index, as a card move is — and the board as it will
 * look, so the columns can be redrawn in their new order before the server has
 * answered.
 */
export interface ListMove {
  readonly listId: string;
  /** The list it should end up in front of. */
  readonly beforeListId: string | null;
  /** The list it should end up behind. */
  readonly afterListId: string | null;
  readonly board: BoardView;
}

/** Whether the thing being dragged is a list rather than a card on one. */
export function isList(view: BoardView, draggedId: string): boolean {
  return view.lists.some((list) => list.id === draggedId);
}

/**
 * Turns a column dropped on another column into a move.
 *
 * Returns null when the drop changes nothing, so the caller does not send a
 * command that would do no work.
 */
export function resolveListDrop(
  view: BoardView,
  activeId: string,
  overId: string,
): ListMove | null {
  const drop = resolveDrop(view.lists, activeId, overId);

  if (drop === null) {
    return null;
  }

  return {
    listId: drop.movedId,
    beforeListId: drop.beforeId,
    afterListId: drop.afterId,
    board: { ...view, lists: [...inDroppedOrder(view.lists, drop.order)] },
  };
}

/**
 * What a drag on the board can be dropped on, which depends on what is being
 * dragged.
 *
 * A card may be dropped on another card or on a column. A column may only be
 * dropped on another column — without saying so, dragging one would collide
 * with whatever card happens to be under the pointer, which is a card in nearly
 * every position a column can be dragged to, and the drop would mean nothing.
 */
export function collisionsOnBoard(view: BoardView): CollisionDetection {
  return (args) => {
    if (!isList(view, String(args.active.id))) {
      return underThePointer(args);
    }

    return underThePointer({
      ...args,
      droppableContainers: args.droppableContainers.filter((container) =>
        isList(view, String(container.id)),
      ),
    });
  };
}
