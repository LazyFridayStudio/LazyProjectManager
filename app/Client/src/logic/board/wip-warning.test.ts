import type { BoardView } from '@lpm/shared';
import { describe, expect, it } from 'vitest';

import { describeOverLimit } from './wip-warning.js';

interface BoardShape {
  readonly wipIsAdvisory: boolean;
  readonly wipLimit: number | null;
  readonly count: number;
}

/** A board of one list, holding whatever the test needs it to hold. */
function board({ wipIsAdvisory, wipLimit, count }: BoardShape): BoardView {
  return {
    boardId: '018f0000-0000-7000-8000-0000000000b0',
    project: {
      id: '018f0000-0000-7000-8000-0000000000p0',
      name: 'Drowned Reach',
      code: 'DRCH',
      slug: 'drowned-reach',
      archived: false,
      wipIsAdvisory,
    },
    issues: null,
    lists: [{ id: 'doing', name: 'In progress', color: '#f0de8a', wipLimit, count, cards: [] }],
  };
}

describe('GIVEN a card has been dropped into a list that is now over its limit', () => {
  describe('WHEN the board treats its limits as advice', () => {
    it('THEN it says so, because nothing else is going to', () => {
      const view = board({ wipIsAdvisory: true, wipLimit: 8, count: 9 });

      expect(describeOverLimit(view, 'doing')).toBe('In progress is over its limit of 8.');
    });
  });

  describe('WHEN the limit is a rule', () => {
    it('THEN it says nothing, because the server refusing the move is the message', () => {
      const view = board({ wipIsAdvisory: false, wipLimit: 8, count: 9 });

      expect(describeOverLimit(view, 'doing')).toBeNull();
    });
  });
});

describe('GIVEN a board that treats its limits as advice', () => {
  describe('WHEN a card is dropped into a list that is still within its limit', () => {
    it('THEN there is nothing to say', () => {
      const view = board({ wipIsAdvisory: true, wipLimit: 8, count: 8 });

      expect(describeOverLimit(view, 'doing')).toBeNull();
    });
  });

  describe('WHEN the list it was dropped into has no limit at all', () => {
    it('THEN there is nothing to be over', () => {
      const view = board({ wipIsAdvisory: true, wipLimit: null, count: 400 });

      expect(describeOverLimit(view, 'doing')).toBeNull();
    });
  });

  describe('WHEN the list is no longer on the board', () => {
    it('THEN it says nothing rather than guessing', () => {
      const view = board({ wipIsAdvisory: true, wipLimit: 1, count: 9 });

      expect(describeOverLimit(view, 'archived-list')).toBeNull();
    });
  });
});
