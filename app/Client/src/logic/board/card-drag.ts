import type { BoardView, CardChip } from '@lpm/shared';

/**
 * Where a dragged card should end up, expressed the way the command takes it.
 *
 * Neighbours rather than an index, because an index means something different by
 * the time it reaches the server — somebody else may have dropped a card above
 * it in between.
 */
export interface CardMove {
  readonly cardId: string;
  readonly toListId: string;
  /** The card it should end up above. */
  readonly beforeCardId: string | null;
  /** The card it should end up below. */
  readonly afterCardId: string | null;
}

/**
 * Turns a drop onto a card, or onto a list's empty space, into a move.
 *
 * Returns null when the drop changes nothing — dropped on itself, or outside the
 * board — so the caller does not send a command that would do no work.
 */
export function resolveDrop(view: BoardView, activeId: string, overId: string): CardMove | null {
  const from = findCard(view, activeId);

  if (from === null || activeId === overId) {
    return null;
  }

  const targetList = view.lists.find((list) => list.id === overId);

  return targetList === undefined
    ? dropOnCard(view, from, overId)
    : dropOnList(from, targetList, activeId);
}

/** Dropped on a list rather than on a card: the card goes to the end of it. */
function dropOnList(
  from: FoundCard,
  targetList: BoardView['lists'][number],
  activeId: string,
): CardMove | null {
  const afterCardId = lastCardOtherThan(targetList.cards, activeId);
  const move = { cardId: activeId, toListId: targetList.id, beforeCardId: null, afterCardId };

  return sameSpot(from, move) ? null : move;
}

function dropOnCard(view: BoardView, from: FoundCard, overId: string): CardMove | null {
  const over = findCard(view, overId);

  if (over === null) {
    return null;
  }

  const remaining = over.list.cards.filter((card) => card.id !== from.card.id);
  const overIndex = remaining.findIndex((card) => card.id === overId);

  if (overIndex === -1) {
    return null;
  }

  // Dragging down past a card lands below it; dragging up lands above it.
  const isMovingDown = from.list.id === over.list.id && from.index < over.index;

  const move = {
    cardId: from.card.id,
    toListId: over.list.id,
    beforeCardId: isMovingDown ? (remaining[overIndex + 1]?.id ?? null) : overId,
    afterCardId: isMovingDown ? overId : (remaining[overIndex - 1]?.id ?? null),
  };

  return sameSpot(from, move) ? null : move;
}

/**
 * Where a card currently sits, as the move that would put it there.
 *
 * Used at the end of a drag: the board has already been rewritten to follow the
 * pointer, so what the command needs is a description of where the card ended up
 * rather than of the drop that put it there.
 */
export function describePlacement(view: BoardView, cardId: string): CardMove | null {
  const found = findCard(view, cardId);

  if (found === null) {
    return null;
  }

  return {
    cardId,
    toListId: found.list.id,
    beforeCardId: found.list.cards[found.index + 1]?.id ?? null,
    afterCardId: found.list.cards[found.index - 1]?.id ?? null,
  };
}

/**
 * Applies a move to a board already on screen.
 *
 * The card lands where it was dropped before the server has answered, which is
 * what makes dragging feel like moving something rather than requesting a move.
 * If the server refuses — a list at its limit — the caller puts the old board
 * back.
 */
export function applyCardMove(view: BoardView, move: CardMove): BoardView {
  const moved = findCard(view, move.cardId)?.card;

  if (moved === undefined) {
    return view;
  }

  return {
    ...view,
    lists: view.lists.map((list) => {
      const without = list.cards.filter((card) => card.id !== move.cardId);

      if (list.id !== move.toListId) {
        return { ...list, cards: without, count: countAfter(list.count, list.cards, without) };
      }

      const cards = insertAt(without, moved, move);

      return { ...list, cards, count: countAfter(list.count, list.cards, cards) };
    }),
  };
}

interface FoundCard {
  readonly card: CardChip;
  readonly list: BoardView['lists'][number];
  readonly index: number;
}

function findCard(view: BoardView, cardId: string): FoundCard | null {
  for (const list of view.lists) {
    const index = list.cards.findIndex((card) => card.id === cardId);

    if (index !== -1) {
      // Present by construction: `findIndex` just found it.
      const card = list.cards[index] as CardChip;

      return { card, list, index };
    }
  }

  return null;
}

function insertAt(cards: readonly CardChip[], moved: CardChip, move: CardMove): CardChip[] {
  const index = indexForMove(cards, move);

  return [...cards.slice(0, index), moved, ...cards.slice(index)];
}

function indexForMove(cards: readonly CardChip[], move: CardMove): number {
  if (move.beforeCardId !== null) {
    const before = cards.findIndex((card) => card.id === move.beforeCardId);

    if (before !== -1) {
      return before;
    }
  }

  if (move.afterCardId !== null) {
    const after = cards.findIndex((card) => card.id === move.afterCardId);

    if (after !== -1) {
      return after + 1;
    }
  }

  return cards.length;
}

/**
 * A list's count includes cards beyond the ones it returned, so it moves by the
 * difference rather than being replaced by the visible length.
 */
function countAfter(
  count: number,
  before: readonly CardChip[],
  after: readonly CardChip[],
): number {
  return Math.max(0, count + (after.length - before.length));
}

function lastCardOtherThan(cards: readonly CardChip[], cardId: string): string | null {
  const remaining = cards.filter((card) => card.id !== cardId);

  return remaining.at(-1)?.id ?? null;
}

/** Whether a move would put the card exactly where it already is. */
function sameSpot(from: FoundCard, move: CardMove): boolean {
  if (from.list.id !== move.toListId) {
    return false;
  }

  const neighbourAbove = from.list.cards[from.index - 1]?.id ?? null;
  const neighbourBelow = from.list.cards[from.index + 1]?.id ?? null;

  return move.afterCardId === neighbourAbove && move.beforeCardId === neighbourBelow;
}
