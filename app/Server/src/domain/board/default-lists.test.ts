import { describe, expect, it } from 'vitest';

import { positionBetween, DEFAULT_LISTS, POSITION_STEP } from './default-lists.js';

describe('GIVEN the lists a new board starts with', () => {
  describe('WHEN a project is created', () => {
    it('THEN there are lists to put work on, in increasing position order', () => {
      const positions = DEFAULT_LISTS.map((list) => list.position);

      expect(DEFAULT_LISTS.length).toBeGreaterThan(0);
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
    });

    it('THEN every colour is one the list table would accept', () => {
      for (const list of DEFAULT_LISTS) {
        expect(list.color).toMatch(/^#[0-9a-f]{6}$/);
      }
    });

    it('THEN a limit, where there is one, is a number a list could reach', () => {
      for (const list of DEFAULT_LISTS) {
        expect(list.wipLimit === null || list.wipLimit > 0).toBe(true);
      }
    });
  });
});

describe('GIVEN something dropped between two neighbours', () => {
  describe('WHEN it lands between two cards', () => {
    it('THEN it takes the midpoint, so only its own row is written', () => {
      expect(positionBetween(1000, 2000)).toBe(1500);
      expect(positionBetween(1000, 1001)).toBe(1000.5);
    });
  });

  describe('WHEN it lands at one end', () => {
    it('THEN it takes half the first position, or a step past the last', () => {
      expect(positionBetween(null, 1000)).toBe(500);
      expect(positionBetween(4000, null)).toBe(4000 + POSITION_STEP);
    });
  });

  describe('WHEN the list is empty', () => {
    it('THEN it starts a step in, leaving room to be dropped above later', () => {
      expect(positionBetween(null, null)).toBe(POSITION_STEP);
    });
  });

  describe('WHEN the same gap is halved over and over', () => {
    it('THEN it keeps producing a value strictly between the two', () => {
      // The property that makes midpoint insertion work. It only fails once the
      // gap is too small for a double, which is what reindexing is for.
      let before = 1000;
      const after = 2000;

      for (let index = 0; index < 40; index++) {
        const middle = positionBetween(before, after);

        expect(middle).toBeGreaterThan(before);
        expect(middle).toBeLessThan(after);
        before = middle;
      }
    });
  });
});
