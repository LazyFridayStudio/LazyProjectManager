import type { BoardView } from '@lpm/shared';

/**
 * What to say about a card just dropped into a list that is now over its limit,
 * if anything.
 *
 * Only a board where the limit is advice has anything to say here. Where the
 * limit is a rule the server refuses the move and the card comes back, and its
 * refusal is the message — a warning as well would be two messages about one
 * drop, and the misleading one of the two, because nothing went over anything.
 *
 * Advice that says nothing when it is ignored is a number on a wall. The column
 * already turns red, but nobody is looking at a column heading at the moment
 * they let go of a card.
 */
export function describeOverLimit(view: BoardView, listId: string): string | null {
  if (!view.project.wipIsAdvisory) {
    return null;
  }

  const list = view.lists.find((each) => each.id === listId);

  // Null for a list with no limit, and undefined for one that is no longer on
  // the board — neither of which is something to be over.
  if (list?.wipLimit == null || list.count <= list.wipLimit) {
    return null;
  }

  return `${list.name} is over its limit of ${String(list.wipLimit)}.`;
}
