import { describe, expect, it } from 'vitest';

import { bestLevel, isAtLeastLevel } from './access-levels.js';

describe('GIVEN two levels to compare', () => {
  describe('WHEN one is asked whether it is enough for the other', () => {
    it('THEN write is enough for read, and read is not enough for write', () => {
      expect(isAtLeastLevel('write', 'read')).toBe(true);
      expect(isAtLeastLevel('read', 'write')).toBe(false);
    });

    it('THEN none is enough for nothing but none', () => {
      expect(isAtLeastLevel('none', 'read')).toBe(false);
      expect(isAtLeastLevel('none', 'none')).toBe(true);
    });
  });

  describe('WHEN the best of a set is asked for', () => {
    it('THEN an empty set reaches nothing', () => {
      expect(bestLevel([])).toBe('none');
    });

    it('THEN one write is enough to make the whole set write', () => {
      expect(bestLevel(['none', 'read', 'write', 'read'])).toBe('write');
    });
  });
});
