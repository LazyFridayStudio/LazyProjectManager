import type { BoardView, TaskListView } from '@lpm/shared';

/** Somebody a card is on, as the filter panel needs them. */
export interface BoardPerson {
  readonly userId: string;
  readonly displayName: string;
  readonly initials: string;
  readonly avatarUrl: string | null;
}

/**
 * Everybody who is on a card here, once each, in the order people read names.
 *
 * Off the cards rather than off the project's membership, because the question
 * the panel answers is "whose work is on this board" — offering forty people
 * from a studio-wide team to narrow a board of nine cards is a list nobody can
 * use. Everybody on a card stays on offer whatever is already chosen, or
 * choosing one person would empty the row they came from.
 */
export function peopleOnTheBoard(view: BoardView): readonly BoardPerson[] {
  return sorted(view.lists.flatMap((list) => list.cards.map((card) => card.assignee)));
}

export function peopleOnTheList(view: TaskListView): readonly BoardPerson[] {
  return sorted(view.rows.map((row) => row.assignee));
}

/** Whether anything here is on nobody, so the choice is worth offering. */
export function someCardIsUnassigned(view: BoardView): boolean {
  return view.lists.some((list) => list.cards.some((card) => card.assignee === null));
}

export function someRowIsUnassigned(view: TaskListView): boolean {
  return view.rows.some((row) => row.assignee === null);
}

function sorted(assignees: readonly (BoardPerson | null)[]): readonly BoardPerson[] {
  const byId = new Map<string, BoardPerson>();

  for (const assignee of assignees) {
    if (assignee !== null) {
      byId.set(assignee.userId, assignee);
    }
  }

  return [...byId.values()].sort((one, other) => one.displayName.localeCompare(other.displayName));
}
