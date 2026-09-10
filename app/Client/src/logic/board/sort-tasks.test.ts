import type { TaskRow } from '@lpm/shared';
import { describe, expect, it } from 'vitest';

import { nextSort, sortTasks, type TaskSort } from './sort-tasks.js';

const LISTS = ['Backlog', 'In progress', 'Ready for review', 'Done'];

function row(fields: Partial<TaskRow> & { cardKey: string }): TaskRow {
  return {
    id: fields.cardKey,
    type: 'task',
    title: fields.cardKey,
    listName: 'Backlog',
    listColor: '#adadad',
    milestone: null,
    priority: null,
    points: null,
    blocked: false,
    estimateMinutes: null,
    loggedMinutes: 0,
    assignee: null,
    assetKey: null,
    closed: false,
    ...fields,
  };
}

function keysOf(rows: readonly TaskRow[], sort: TaskSort | null): string[] {
  return sortTasks(rows, sort, LISTS).map((each) => each.cardKey);
}

describe('GIVEN a table of tasks', () => {
  describe('WHEN no column has been pressed', () => {
    it('THEN they stay in the order they arrived, which is board order', () => {
      const rows = [row({ cardKey: 'c' }), row({ cardKey: 'a' }), row({ cardKey: 'b' })];

      expect(keysOf(rows, null)).toEqual(['c', 'a', 'b']);
    });

    it('THEN sorting hands back a copy, because the rows belong to the cache', () => {
      const rows = [row({ cardKey: 'b' }), row({ cardKey: 'a' })];

      sortTasks(rows, { column: 'summary', descending: false }, LISTS);

      expect(rows.map((each) => each.cardKey)).toEqual(['b', 'a']);
    });
  });

  describe('WHEN a column of words is pressed', () => {
    it('THEN they go in alphabetical order', () => {
      const rows = [
        row({ cardKey: '1', title: 'Retopologise the deck' }),
        row({ cardKey: '2', title: 'Crane winch' }),
        row({ cardKey: '3', title: 'harbour fog' }),
      ];

      // Case ignored: `harbour` belongs with the H's rather than after the Z's.
      expect(keysOf(rows, { column: 'summary', descending: false })).toEqual(['2', '3', '1']);
    });

    it('THEN a number inside a name is read as a number', () => {
      const rows = [
        row({ cardKey: '1', title: 'Filler 10' }),
        row({ cardKey: '2', title: 'Filler 9' }),
      ];

      expect(keysOf(rows, { column: 'summary', descending: false })).toEqual(['2', '1']);
    });
  });

  describe('WHEN status is pressed', () => {
    it('THEN it goes in board order rather than alphabetical order', () => {
      const rows = [
        row({ cardKey: 'done', listName: 'Done' }),
        row({ cardKey: 'backlog', listName: 'Backlog' }),
        row({ cardKey: 'doing', listName: 'In progress' }),
      ];

      // Alphabetically this would be Backlog, Done, In progress — which says
      // nothing about where the work is up to.
      expect(keysOf(rows, { column: 'status', descending: false })).toEqual([
        'backlog',
        'doing',
        'done',
      ]);
    });
  });

  describe('WHEN priority is pressed', () => {
    it('THEN the highest comes first, because that is what the word means', () => {
      const rows = [
        row({ cardKey: 'low', priority: 'low' }),
        row({ cardKey: 'highest', priority: 'highest' }),
        row({ cardKey: 'medium', priority: 'medium' }),
      ];

      expect(keysOf(rows, { column: 'priority', descending: false })).toEqual([
        'highest',
        'medium',
        'low',
      ]);
    });
  });

  describe('WHEN a column has empty cells in it', () => {
    it('THEN they sort last, whichever way the column is pointing', () => {
      const rows = [
        row({ cardKey: 'none' }),
        row({ cardKey: 'four', points: 4 }),
        row({ cardKey: 'one', points: 1 }),
      ];

      expect(keysOf(rows, { column: 'points', descending: false })).toEqual([
        'one',
        'four',
        'none',
      ]);
      // Reversed, and the empty one is still at the bottom rather than at the
      // top of a column somebody has to scroll past.
      expect(keysOf(rows, { column: 'points', descending: true })).toEqual(['four', 'one', 'none']);
    });
  });

  describe('WHEN a heading is pressed again', () => {
    it('THEN it goes up, then down, then back to how it arrived', () => {
      const up = nextSort(null, 'points');
      const down = nextSort(up, 'points');

      expect(up).toEqual({ column: 'points', descending: false });
      expect(down).toEqual({ column: 'points', descending: true });
      expect(nextSort(down, 'points')).toBeNull();
    });

    it('THEN pressing a different heading starts that one at the top', () => {
      const down = { column: 'points', descending: true } as const;

      expect(nextSort(down, 'summary')).toEqual({ column: 'summary', descending: false });
    });
  });
});
