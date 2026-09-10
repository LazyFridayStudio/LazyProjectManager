import type { CardChip, CardPriority, CardType, TaskRow } from '@lpm/shared';

/**
 * What the board has been narrowed to.
 *
 * One value rather than six pieces of state, for the reason `AssetFilters` is
 * one: every part of the screen that cares about filtering cares about all of
 * it — the header count, the empty state, and whether a legend is still worth
 * drawing.
 *
 * The board and the list are one screen behind a tab, so they narrow by this
 * and nothing else. A filter that meant something slightly different on each
 * side would read as a fault rather than as two answers.
 */
export interface TaskFilters {
  /**
   * Whose work, as user ids — with `UNASSIGNED` for nobody's.
   *
   * Several at once, because the question is more often "mine and Mira's" than
   * "mine". Empty means anybody's, which is the whole board.
   */
  readonly assignees: readonly string[];
  readonly types: readonly CardType[];
  readonly priorities: readonly CardPriority[];
  /** Only cards nobody can get on with. */
  readonly blocked: boolean;
  /** Only work that has passed the estimate somebody put on it. */
  readonly overBudget: boolean;
  /**
   * Whether finished work is drawn.
   *
   * Three states rather than a switch, because a board that has been running a
   * while is read all three ways: everything, only what is left, and only what
   * landed.
   */
  readonly completed: 'any' | 'hide' | 'only';
}

/** Nobody, as an assignee that can be chosen. Not a user id, and cannot collide with one. */
export const UNASSIGNED = 'unassigned';

export const NO_FILTERS: TaskFilters = {
  assignees: [],
  types: [],
  priorities: [],
  blocked: false,
  overBudget: false,
  completed: 'any',
};

export function isFiltering(filters: TaskFilters): boolean {
  return countFilters(filters) > 0;
}

/** How many separate things have been asked for, for the summary line. */
export function countFilters(filters: TaskFilters): number {
  return (
    filters.assignees.length +
    filters.types.length +
    filters.priorities.length +
    (filters.blocked ? 1 : 0) +
    (filters.overBudget ? 1 : 0) +
    (filters.completed === 'any' ? 0 : 1)
  );
}

/**
 * Turns one on or off.
 *
 * A chip is the same control either way — pressing one that is already on is
 * how anybody expects to take it off again, and a separate remove would be a
 * second control for the same idea.
 */
export function toggle<TValue extends string>(
  chosen: readonly TValue[],
  value: TValue,
): readonly TValue[] {
  return chosen.includes(value) ? chosen.filter((entry) => entry !== value) : [...chosen, value];
}

/** Work logged past the estimate. A card nobody estimated is never over it. */
export function isOverBudget(work: {
  estimateMinutes: number | null;
  loggedMinutes: number;
}): boolean {
  return work.estimateMinutes !== null && work.loggedMinutes > work.estimateMinutes;
}

function assigneeMatches(filters: TaskFilters, assigneeId: string | null): boolean {
  if (filters.assignees.length === 0) {
    return true;
  }

  return assigneeId === null
    ? filters.assignees.includes(UNASSIGNED)
    : filters.assignees.includes(assigneeId);
}

function completedMatches(filters: TaskFilters, closed: boolean): boolean {
  if (filters.completed === 'any') {
    return true;
  }

  return filters.completed === 'only' ? closed : !closed;
}

/** Everything but the assignee, which a legend answers for the cards under it. */
function ownMatches(
  filters: TaskFilters,
  card: {
    type: CardType;
    priority: CardPriority | null;
    blocked: boolean;
    closed: boolean;
    estimateMinutes: number | null;
    loggedMinutes: number;
  },
): boolean {
  return (
    (filters.types.length === 0 || filters.types.includes(card.type)) &&
    (filters.priorities.length === 0 ||
      (card.priority !== null && filters.priorities.includes(card.priority))) &&
    (!filters.blocked || card.blocked) &&
    (!filters.overBudget || isOverBudget(card)) &&
    completedMatches(filters, card.closed)
  );
}

export function taskRowMatches(row: TaskRow, filters: TaskFilters): boolean {
  return ownMatches(filters, row) && assigneeMatches(filters, row.assignee?.userId ?? null);
}

/**
 * Whether a chip survives the filter.
 *
 * A legend is a container: nobody is assigned a clump of work and nobody
 * estimates one, so judging it by its own fields would take every legend off
 * the board the moment anything was chosen — and the four cards under it with
 * it, one of which is what somebody was looking for. It stays if anything under
 * it stays.
 *
 * A gathered card carries only a key, a type, a title, whether it is closed and
 * who it is on, so a legend can be judged by the filters that fit on that much.
 * Priority, blocked and over budget are not among them: a legend answers those
 * by keeping the clump rather than by claiming to know.
 */
export function cardChipMatches(chip: CardChip, filters: TaskFilters): boolean {
  if (!chip.isLegend) {
    return ownMatches(filters, chip) && assigneeMatches(filters, chip.assignee?.userId ?? null);
  }

  return chip.gathers.some(
    (card) =>
      assigneeMatches(filters, card.assigneeId) &&
      (filters.types.length === 0 || filters.types.includes(card.type)) &&
      completedMatches(filters, card.closed),
  );
}

/** How many of the cards under a legend survive, which is what the clump says. */
export function countMatchingUnder(chip: CardChip, filters: TaskFilters): number {
  return chip.gathers.filter(
    (card) =>
      assigneeMatches(filters, card.assigneeId) &&
      (filters.types.length === 0 || filters.types.includes(card.type)) &&
      completedMatches(filters, card.closed),
  ).length;
}
