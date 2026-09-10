import type { BoardView, CardChip } from '@lpm/shared';
import { describe, expect, it } from 'vitest';

import { applyCardMove, describePlacement, resolveDrop } from './card-drag.js';

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

/** Two lists: `backlog` holds a, b, c and `doing` holds x. */
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
    lists: [
      {
        id: 'backlog',
        name: 'Backlog',
        color: '#adadad',
        wipLimit: null,
        count: 3,
        cards: [card('a'), card('b'), card('c')],
      },
      {
        id: 'doing',
        name: 'In progress',
        color: '#f0de8a',
        wipLimit: 8,
        count: 1,
        cards: [card('x')],
      },
    ],
  };
}

/** The card ids in each list, which is the only thing a move is meant to change. */
function layout(view: BoardView): Record<string, string[]> {
  return Object.fromEntries(view.lists.map((list) => [list.id, list.cards.map((one) => one.id)]));
}

describe('GIVEN a card dropped somewhere on the board', () => {
  describe('WHEN it is dropped on a card lower down its own list', () => {
    it('THEN it lands below that card', () => {
      const move = resolveDrop(board(), 'a', 'c');

      expect(move).toEqual({
        cardId: 'a',
        toListId: 'backlog',
        beforeCardId: null,
        afterCardId: 'c',
      });
    });
  });

  describe('WHEN it is dropped on a card higher up its own list', () => {
    it('THEN it lands above that card', () => {
      const move = resolveDrop(board(), 'c', 'a');

      expect(move).toEqual({
        cardId: 'c',
        toListId: 'backlog',
        beforeCardId: 'a',
        afterCardId: null,
      });
    });
  });

  describe('WHEN it is dropped on a card in another list', () => {
    it('THEN it lands above that card, in that list', () => {
      const move = resolveDrop(board(), 'a', 'x');

      expect(move).toEqual({
        cardId: 'a',
        toListId: 'doing',
        beforeCardId: 'x',
        afterCardId: null,
      });
    });
  });

  describe('WHEN it is dropped on a list rather than on a card', () => {
    it('THEN it goes to the end of that list', () => {
      const move = resolveDrop(board(), 'a', 'doing');

      expect(move).toEqual({
        cardId: 'a',
        toListId: 'doing',
        beforeCardId: null,
        afterCardId: 'x',
      });
    });

    it('THEN an empty list takes it with no neighbours at all', () => {
      const view = board();
      view.lists[1] = { ...view.lists[1]!, cards: [], count: 0 };

      expect(resolveDrop(view, 'a', 'doing')).toEqual({
        cardId: 'a',
        toListId: 'doing',
        beforeCardId: null,
        afterCardId: null,
      });
    });
  });

  describe('WHEN the drop would change nothing', () => {
    it('THEN there is no move, so no command is sent', () => {
      // Dropped on itself, on the neighbour it already sits above, or on the
      // end of the list it is already at the end of.
      expect(resolveDrop(board(), 'a', 'a')).toBeNull();
      expect(resolveDrop(board(), 'a', 'backlog')).not.toBeNull();
      expect(resolveDrop(board(), 'c', 'backlog')).toBeNull();
      expect(resolveDrop(board(), 'x', 'doing')).toBeNull();
    });

    it('THEN a drop on something that is not on the board is ignored', () => {
      expect(resolveDrop(board(), 'a', 'nowhere')).toBeNull();
      expect(resolveDrop(board(), 'nothing', 'backlog')).toBeNull();
    });
  });
});

describe('GIVEN a move applied to the board on screen', () => {
  describe('WHEN a card moves within its list', () => {
    it('THEN it appears in its new place immediately', () => {
      const move = resolveDrop(board(), 'a', 'c');
      const after = applyCardMove(board(), move!);

      expect(layout(after)).toEqual({ backlog: ['b', 'c', 'a'], doing: ['x'] });
    });
  });

  describe('WHEN a card moves to another list', () => {
    it('THEN it leaves one and joins the other', () => {
      const move = resolveDrop(board(), 'a', 'x');
      const after = applyCardMove(board(), move!);

      expect(layout(after)).toEqual({ backlog: ['b', 'c'], doing: ['a', 'x'] });
    });

    it('THEN both counts follow it', () => {
      const move = resolveDrop(board(), 'a', 'x');
      const after = applyCardMove(board(), move!);

      expect(after.lists[0]?.count).toBe(2);
      expect(after.lists[1]?.count).toBe(2);
    });

    it('THEN a count that included cards beyond the cap still moves by one', () => {
      // A list reporting 240 cards while showing 200 must end up at 239, not
      // at the length of what happened to be on screen.
      const view = board();
      view.lists[0] = { ...view.lists[0]!, count: 240 };

      const after = applyCardMove(view, resolveDrop(view, 'a', 'x')!);

      expect(after.lists[0]?.count).toBe(239);
    });
  });

  describe('WHEN the card is not on the board', () => {
    it('THEN nothing changes', () => {
      const view = board();
      const after = applyCardMove(view, {
        cardId: 'nothing',
        toListId: 'doing',
        beforeCardId: null,
        afterCardId: null,
      });

      expect(layout(after)).toEqual(layout(view));
    });
  });

  describe('WHEN the named neighbour has since gone', () => {
    it('THEN the card still lands in the list rather than vanishing', () => {
      const after = applyCardMove(board(), {
        cardId: 'a',
        toListId: 'doing',
        beforeCardId: 'gone',
        afterCardId: null,
      });

      expect(layout(after)).toEqual({ backlog: ['b', 'c'], doing: ['x', 'a'] });
    });
  });
});

describe('GIVEN a card that has already been dragged into place', () => {
  describe('WHEN the drag ends', () => {
    it('THEN where it sits is described by the cards either side of it', () => {
      expect(describePlacement(board(), 'b')).toEqual({
        cardId: 'b',
        toListId: 'backlog',
        beforeCardId: 'c',
        afterCardId: 'a',
      });
    });

    it('THEN the top and bottom of a list have one neighbour each', () => {
      expect(describePlacement(board(), 'a')).toMatchObject({
        beforeCardId: 'b',
        afterCardId: null,
      });
      expect(describePlacement(board(), 'c')).toMatchObject({
        beforeCardId: null,
        afterCardId: 'b',
      });
    });

    it('THEN a card alone in its list has neither', () => {
      expect(describePlacement(board(), 'x')).toEqual({
        cardId: 'x',
        toListId: 'doing',
        beforeCardId: null,
        afterCardId: null,
      });
    });

    it('THEN a card that is not on the board describes nothing', () => {
      expect(describePlacement(board(), 'nothing')).toBeNull();
    });
  });

  describe('WHEN a drag is replayed the way the board does it', () => {
    it('THEN the placement it reports is the one that was asked for', () => {
      // The drag applies each step to the board, then describes where the card
      // ended up. Those two have to agree, or every drag would send the server
      // somewhere other than what the screen shows.
      const dropped = applyCardMove(board(), resolveDrop(board(), 'a', 'x')!);

      expect(describePlacement(dropped, 'a')).toEqual({
        cardId: 'a',
        toListId: 'doing',
        beforeCardId: 'x',
        afterCardId: null,
      });
    });
  });
});
