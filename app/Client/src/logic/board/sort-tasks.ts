import { CARD_PRIORITIES, describeCardType, type TaskRow } from '@lpm/shared';

/**
 * How a column of the task list is ordered when somebody asks for it.
 *
 * Six of the nine columns sort. The key is already the order the keys were
 * issued in, and who a card is on and what asset it is about are things you
 * look for rather than read down — a column that sorts and means nothing sorted
 * is a control that wastes a press.
 *
 * Every column sorts by what is in the cell, with two exceptions that would be
 * nonsense otherwise:
 *
 * **Status** goes in board order, left to right. Sorted by name it reads
 * Backlog, Done, In progress, Ready for review — alphabetical, and silent about
 * where the work is up to.
 *
 * **Priority** goes highest first, because that is what the words mean. Sorted
 * by name it reads High, Highest, Low, Medium.
 */
export type TaskSortColumn = 'type' | 'summary' | 'status' | 'milestone' | 'priority' | 'points';

export interface TaskSort {
  readonly column: TaskSortColumn;
  readonly descending: boolean;
}

/**
 * What pressing a heading does.
 *
 * Three states rather than two: up, down, and back to how it arrived. Board
 * order is worth being able to return to, and a table that can only be sorted
 * is one somebody has to reload to un-sort.
 */
export function nextSort(current: TaskSort | null, column: TaskSortColumn): TaskSort | null {
  if (current?.column !== column) {
    return { column, descending: false };
  }

  return current.descending ? null : { column, descending: true };
}

/**
 * Rows in the order asked for, or in the order they arrived.
 *
 * A copy rather than in place: the rows belong to the query cache, and sorting
 * the array it handed over would reorder it for everything else reading the
 * same answer.
 */
export function sortTasks(
  rows: readonly TaskRow[],
  sort: TaskSort | null,
  listOrder: readonly string[],
): TaskRow[] {
  if (sort === null) {
    return [...rows];
  }

  const read = readerFor(sort.column, listOrder);
  const direction = sort.descending ? -1 : 1;

  return [...rows].sort((left, right) => {
    const first = read(left);
    const second = read(right);

    /*
     * An empty cell sorts last either way.
     *
     * A card with no milestone is not the earliest milestone, and a run of
     * dashes at the top is something to scroll past before the column answers
     * the question it was pressed for. So the direction is applied to the cells
     * that have something in them, and the rest stay at the bottom.
     */
    if (first === null || second === null) {
      return emptyLast(first, second);
    }

    return compare(first, second) * direction;
  });
}

/** What a column reads out of a row: a word, a number, or nothing. */
type Cell = string | number | null;

function readerFor(column: TaskSortColumn, listOrder: readonly string[]): (row: TaskRow) => Cell {
  if (column === 'type') {
    return (row) => describeCardType(row.type);
  }

  if (column === 'summary') {
    return (row) => row.title;
  }

  if (column === 'status') {
    return (row) => {
      const place = listOrder.indexOf(row.listName);

      return place === -1 ? null : place;
    };
  }

  if (column === 'milestone') {
    return (row) => row.milestone?.name ?? null;
  }

  if (column === 'priority') {
    return (row) => (row.priority === null ? null : CARD_PRIORITIES.indexOf(row.priority));
  }

  return (row) => row.points;
}

/**
 * Case and accents ignored, and digits read as numbers.
 *
 * `Filler 10` after `Filler 9` rather than before it, which is what anybody
 * reading a column of names expects and what comparing the strings does not do.
 */
const words = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compare(first: string | number, second: string | number): number {
  return typeof first === 'string' && typeof second === 'string'
    ? words.compare(first, second)
    : Number(first) - Number(second);
}

function emptyLast(first: Cell, second: Cell): number {
  if (first === null && second === null) {
    return 0;
  }

  return first === null ? 1 : -1;
}
