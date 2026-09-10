import type { Active, ClientRect, DroppableContainer } from '@dnd-kit/core';
import type { BoardList, BoardView, CardChip } from '@lpm/shared';
import { describe, expect, it } from 'vitest';

import { collisionsOnBoard, columnsStepAside, isList, resolveListDrop } from './list-drag.js';

function card(id: string): CardChip {
  return {
    id,
    cardKey: `DRCH-TASK-${id}`,
    type: 'task',
    title: id,
    priority: null,
    points: null,
    dueOn: null,
    blocked: false,
    estimateMinutes: null,
    loggedMinutes: 0,
    closed: false,
    assignee: null,
    isLegend: false,
    gathers: [],
  };
}

function list(id: string, cards: CardChip[] = []): BoardList {
  return { id, name: id, color: '#adadad', wipLimit: null, count: cards.length, cards };
}

/** The four lists a board starts with, in the order it starts with them. */
function board(): BoardView {
  return {
    boardId: '018f0000-0000-7000-8000-0000000000b0',
    project: {
      id: '018f0000-0000-7000-8000-0000000000p0',
      name: 'Drowned Reach',
      code: 'DRCH',
      slug: 'drowned-reach',
      archived: false,
      wipIsAdvisory: false,
    },
    issues: null,
    lists: [list('backlog'), list('doing'), list('review'), list('done', [card('a')])],
  };
}

function order(view: BoardView): string[] {
  return view.lists.map((each) => each.id);
}

describe('GIVEN a board of four lists', () => {
  describe('WHEN the last one is dragged onto the second', () => {
    it('THEN it lands in front of the one it was dropped on', () => {
      const move = resolveListDrop(board(), 'done', 'doing');

      expect(move).toMatchObject({
        listId: 'done',
        beforeListId: 'doing',
        afterListId: 'backlog',
      });
    });

    it('THEN the board it returns already shows the columns in that order', () => {
      const move = resolveListDrop(board(), 'done', 'doing');

      expect(order(move?.board ?? board())).toEqual(['backlog', 'done', 'doing', 'review']);
    });

    it('THEN the cards travel with the column rather than being left behind', () => {
      const move = resolveListDrop(board(), 'done', 'doing');
      const moved = move?.board.lists.find((each) => each.id === 'done');

      expect(moved?.cards.map((each) => each.id)).toEqual(['a']);
    });
  });

  describe('WHEN the first one is dragged onto the last', () => {
    it('THEN it goes on the end, with nothing in front of it', () => {
      const move = resolveListDrop(board(), 'backlog', 'done');

      expect(move).toMatchObject({ beforeListId: null, afterListId: 'done' });
      expect(order(move?.board ?? board())).toEqual(['doing', 'review', 'done', 'backlog']);
    });
  });

  describe('WHEN a list is dropped back on itself', () => {
    it('THEN nothing is asked of the server', () => {
      expect(resolveListDrop(board(), 'doing', 'doing')).toBeNull();
    });
  });

  describe('WHEN a list is dropped on something that is not a list', () => {
    it('THEN nothing is asked of the server', () => {
      expect(resolveListDrop(board(), 'doing', 'a')).toBeNull();
    });
  });

  describe('WHEN asked what is being dragged', () => {
    it('THEN a list id is a list and a card id is not', () => {
      expect(isList(board(), 'doing')).toBe(true);
      expect(isList(board(), 'a')).toBe(false);
    });
  });
});

const COLUMN_RECTS = [
  { left: 0, top: 0, width: 200, height: 800, right: 200, bottom: 800 },
  { left: 220, top: 0, width: 200, height: 800, right: 420, bottom: 800 },
];

describe('GIVEN something is being dragged across the board', () => {
  describe('WHEN it is one of the columns', () => {
    it('THEN the columns it is passing step aside for it', () => {
      const stepped = columnsStepAside({
        rects: COLUMN_RECTS,
        activeNodeRect: COLUMN_RECTS[1] ?? null,
        activeIndex: 1,
        overIndex: 0,
        index: 0,
      });

      expect(stepped).not.toBeNull();
    });
  });

  describe('WHEN it is a card being carried over a column', () => {
    it('THEN the columns stay where they are', () => {
      const stepped = columnsStepAside({
        rects: COLUMN_RECTS,
        // The card, which is not one of the columns and so has no index in them.
        activeNodeRect: { left: 8, top: 40, width: 184, height: 80, right: 192, bottom: 120 },
        activeIndex: -1,
        overIndex: 1,
        index: 0,
      });

      expect(stepped).toBeNull();
    });
  });
});

const RECTS = new Map<string, ClientRect>([
  ['backlog', { left: 0, top: 0, width: 200, height: 800, right: 200, bottom: 800 }],
  ['done', { left: 220, top: 0, width: 200, height: 800, right: 420, bottom: 800 }],
  ['a', { left: 228, top: 40, width: 184, height: 80, right: 412, bottom: 120 }],
]);

function droppable(id: string): DroppableContainer {
  return {
    id,
    key: id,
    data: { current: undefined },
    disabled: false,
    node: { current: null },
    rect: { current: RECTS.get(id) ?? null },
  };
}

function dragged(id: string): Active {
  return {
    id,
    data: { current: undefined },
    rect: { current: { initial: null, translated: null } },
  };
}

/** What the drag would be dropped on, with the pointer over the card in Done. */
function collisionsWhileDragging(draggedId: string): string[] {
  return collisionsOnBoard(board())({
    active: dragged(draggedId),
    collisionRect: RECTS.get(draggedId) ?? {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      right: 0,
      bottom: 0,
    },
    droppableRects: RECTS,
    droppableContainers: ['backlog', 'done', 'a'].map(droppable),
    pointerCoordinates: { x: 300, y: 80 },
  }).map((collision) => String(collision.id));
}

describe('GIVEN the pointer is over a card in one of the columns', () => {
  describe('WHEN a column is being dragged', () => {
    it('THEN it is the column under the pointer that it would be dropped on', () => {
      expect(collisionsWhileDragging('backlog')[0]).toBe('done');
    });

    it('THEN no card is offered as somewhere to put a column', () => {
      expect(collisionsWhileDragging('backlog')).not.toContain('a');
    });
  });

  describe('WHEN a card is being dragged', () => {
    it('THEN the card under the pointer is still what it would be dropped on', () => {
      expect(collisionsWhileDragging('a')[0]).toBe('a');
    });
  });
});
