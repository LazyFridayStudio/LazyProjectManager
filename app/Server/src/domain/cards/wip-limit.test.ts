import { describe, expect, it } from 'vitest';

import { assertListHasRoom, WipLimitReachedError } from './wip-limit.js';

const IN_PROGRESS = { listName: 'In progress', isAdvisory: false };

describe('GIVEN a card arriving in a list', () => {
  describe('WHEN the list has no limit', () => {
    it('THEN it is accepted however full it is', () => {
      expect(() => {
        assertListHasRoom({ ...IN_PROGRESS, wipLimit: null, openCardCount: 500 });
      }).not.toThrow();
    });
  });

  describe('WHEN the list has room', () => {
    it('THEN it is accepted', () => {
      expect(() => {
        assertListHasRoom({ ...IN_PROGRESS, wipLimit: 8, openCardCount: 7 });
      }).not.toThrow();
    });
  });

  describe('WHEN the list is at its limit', () => {
    it('THEN it is refused, because a limit that only warns is a number nobody reads', () => {
      expect(() => {
        assertListHasRoom({ ...IN_PROGRESS, wipLimit: 8, openCardCount: 8 });
      }).toThrow(WipLimitReachedError);
    });

    it('THEN it is still refused when the list is already over', () => {
      expect(() => {
        assertListHasRoom({ ...IN_PROGRESS, wipLimit: 8, openCardCount: 12 });
      }).toThrow(WipLimitReachedError);
    });

    it('THEN the message names the list and the number', () => {
      let thrown: unknown;

      try {
        assertListHasRoom({ ...IN_PROGRESS, wipLimit: 8, openCardCount: 8 });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toMatchObject({ code: 'WIP_LIMIT_REACHED' });
      expect((thrown as Error).message).toContain('In progress');
      expect((thrown as Error).message).toContain('8');
    });
  });

  describe('WHEN the project has made its limits advisory', () => {
    it('THEN a full list still accepts the card', () => {
      // The deliberate way out, for a team who would otherwise work around the
      // tool rather than with it.
      expect(() => {
        assertListHasRoom({
          listName: 'In progress',
          wipLimit: 8,
          openCardCount: 20,
          isAdvisory: true,
        });
      }).not.toThrow();
    });
  });
});
