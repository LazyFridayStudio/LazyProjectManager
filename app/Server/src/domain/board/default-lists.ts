/**
 * The lists a new board starts with.
 *
 * A board with no lists is a board nothing can be put on, so every project gets
 * these and renames or removes them afterwards. They match the prototype's
 * board, which is what the colours are.
 *
 * Migration `0003-board` repeats them for the projects that existed before
 * boards did. That copy is frozen on purpose: changing this list must not change
 * what a migration already did.
 */
export interface DefaultList {
  readonly name: string;
  readonly color: string;
  readonly wipLimit: number | null;
  readonly position: number;
}

export const DEFAULT_LISTS: readonly DefaultList[] = [
  { name: 'Backlog', color: '#adadad', wipLimit: null, position: 1000 },
  { name: 'In progress', color: '#f0de8a', wipLimit: 8, position: 2000 },
  { name: 'Ready for review', color: '#63aeeb', wipLimit: 4, position: 3000 },
  { name: 'Done', color: '#63eba3', wipLimit: null, position: 4000 },
];

/**
 * The gap left between adjacent positions.
 *
 * Wide enough that a great many cards can be dropped between two others before
 * the midpoints get small enough to need reindexing.
 */
export const POSITION_STEP = 1000;

/**
 * Where something dropped between two neighbours goes.
 *
 * Positions are `numeric` in Postgres, so the real midpoint arithmetic happens
 * there. This is the same rule expressed for code that already holds both
 * numbers — seeding, and tests.
 */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) {
    return POSITION_STEP;
  }

  if (before === null) {
    return (after ?? 0) / 2;
  }

  if (after === null) {
    return before + POSITION_STEP;
  }

  return (before + after) / 2;
}
