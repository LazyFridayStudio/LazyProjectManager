import { describe, expect, it } from 'vitest';

import { CARD_SEQUENCE_PREFIXES } from '../projects/project-vocabulary.js';
import {
  cardTitleSchema,
  describeCardPriority,
  describeCardType,
  getPrefixForCardType,
  listColorSchema,
  wipLimitSchema,
  CARD_PRIORITIES,
  CARD_TYPES,
} from './board-vocabulary.js';
import { boardViewQuery, cardChipSchema, MAXIMUM_CARDS_PER_LIST } from './queries/board-view.js';

describe('GIVEN the four kinds of card', () => {
  describe('WHEN a card is given a key', () => {
    it('THEN its type maps to a prefix a counter actually exists for', () => {
      // A type whose prefix has no `card_sequence` row is a type no card of can
      // ever be created, and nothing else would catch it.
      for (const cardType of CARD_TYPES) {
        expect(CARD_SEQUENCE_PREFIXES).toContain(getPrefixForCardType(cardType));
      }
    });

    it('THEN no two types share a prefix', () => {
      const prefixes = CARD_TYPES.map(getPrefixForCardType);

      expect(new Set(prefixes).size).toBe(CARD_TYPES.length);
    });
  });

  describe('WHEN a type or priority is written on screen', () => {
    it('THEN it has a label, so no screen renders the stored value', () => {
      for (const cardType of CARD_TYPES) {
        expect(describeCardType(cardType)).not.toBe('');
      }

      for (const priority of CARD_PRIORITIES) {
        expect(describeCardPriority(priority)).not.toBe('');
      }
    });
  });

  describe('WHEN priorities are offered as a filter', () => {
    it('THEN they run most to least urgent', () => {
      expect([...CARD_PRIORITIES]).toEqual(['highest', 'high', 'medium', 'low']);
    });
  });
});

describe('GIVEN a list being described', () => {
  describe('WHEN its colour is given in mixed case', () => {
    it('THEN it is accepted as the lower-case hex the column stores', () => {
      expect(listColorSchema.parse('#ADADAD')).toBe('#adadad');
    });
  });

  describe('WHEN its colour is not a six-digit hex', () => {
    it('THEN it is refused', () => {
      for (const candidate of ['adadad', '#fff', 'red', '#12345g']) {
        expect(listColorSchema.safeParse(candidate).success).toBe(false);
      }
    });
  });

  describe('WHEN its work-in-progress limit is zero', () => {
    it('THEN it is refused, because that is a list nobody could use', () => {
      expect(wipLimitSchema.safeParse(0).success).toBe(false);
      expect(wipLimitSchema.safeParse(1).success).toBe(true);
    });
  });
});

describe('GIVEN a card title', () => {
  describe('WHEN it is blank or only spaces', () => {
    it('THEN it is refused', () => {
      expect(cardTitleSchema.safeParse('').success).toBe(false);
      expect(cardTitleSchema.safeParse('   ').success).toBe(false);
    });
  });

  describe('WHEN it has spaces around it', () => {
    it('THEN they are trimmed', () => {
      expect(cardTitleSchema.parse('  Harbour crane retopo  ')).toBe('Harbour crane retopo');
    });
  });
});

describe('GIVEN the board view contract', () => {
  describe('WHEN a chip comes back from the server', () => {
    it('THEN an unassigned card is accepted, because most cards start that way', () => {
      const chip = {
        id: '018f0000-0000-7000-8000-00000000000a',
        cardKey: 'DRCH-ART-1',
        type: 'art',
        title: 'Leviathan phase-2 silhouette',
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

      expect(cardChipSchema.safeParse(chip).success).toBe(true);
    });

    it('THEN a legend carries what is under it, and an ordinary card carries none', () => {
      const chip = {
        id: '018f0000-0000-7000-8000-00000000000a',
        cardKey: 'DRCH-TASK-1',
        type: 'task',
        title: 'Harbour set: second pass',
        priority: null,
        points: null,
        dueOn: null,
        blocked: false,
        estimateMinutes: null,
        loggedMinutes: 0,
        closed: false,
        assignee: null,
        isLegend: true,
        gathers: [
          {
            id: '018f0000-0000-7000-8000-00000000000b',
            cardKey: 'DRCH-BUG-4',
            type: 'bug',
            title: 'Wet timber decking tiling fix',
            closed: false,
            // Only the id, and only so a filter that asks who the work is on
            // can judge the legend above it.
            assigneeId: '018f0000-0000-7000-8000-00000000000c',
          },
        ],
      };

      // On the chip rather than fetched when the card is opened out: the board
      // draws a legend as its own card, and a spinner inside a card on a board
      // is a worse answer than the rows it is hiding.
      expect(cardChipSchema.safeParse(chip).success).toBe(true);

      // And the absence is a fact, not a maybe: every chip says which it is.
      expect(cardChipSchema.safeParse({ ...chip, isLegend: undefined }).success).toBe(false);
    });

    it('THEN a type the client does not know is refused at the boundary', () => {
      const chip = {
        id: '018f0000-0000-7000-8000-00000000000a',
        cardKey: 'DRCH-XXX-1',
        type: 'epic',
        title: 'Something new',
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

      expect(cardChipSchema.safeParse(chip).success).toBe(false);
    });
  });

  describe('WHEN the board is asked for', () => {
    it('THEN it is addressed by the same slug the project is', () => {
      expect(boardViewQuery.paramsSchema.parse({ slug: 'drowned-reach' })).toEqual({
        slug: 'drowned-reach',
      });
      expect(boardViewQuery.paramsSchema.safeParse({ slug: 'Drowned Reach' }).success).toBe(false);
    });

    it('THEN a list returns a bounded number of cards', () => {
      // An unbounded board query is how one enormous backlog takes the screen
      // down for everybody looking at that project.
      expect(MAXIMUM_CARDS_PER_LIST).toBeGreaterThan(0);
      expect(MAXIMUM_CARDS_PER_LIST).toBeLessThanOrEqual(500);
    });
  });
});
