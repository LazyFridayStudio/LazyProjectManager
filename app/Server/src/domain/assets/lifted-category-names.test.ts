import { MAXIMUM_ASSET_CATEGORY_NAME_LENGTH } from '@lpm/shared';
import { describe, expect, it } from 'vitest';

import { nameWhereTheyLand } from './lifted-category-names.js';

/** What categories coming up out of `Props` are called, beside the names already taken. */
function comingUpOutOfProps(names: readonly string[], taken: readonly string[]): string[] {
  return nameWhereTheyLand({
    leaving: 'Props',
    children: names.map((name, index) => ({ id: `child-${String(index)}`, name })),
    takenWhereTheyLand: new Set(taken),
  }).map((child) => child.name);
}

describe('GIVEN categories coming up out of Props as it is deleted', () => {
  describe('WHEN none of their names is taken where they land', () => {
    it('THEN every one keeps its own name, in the order they were in', () => {
      expect(comingUpOutOfProps(['Interior', 'Exterior'], ['Characters'])).toEqual([
        'Interior',
        'Exterior',
      ]);
    });
  });

  describe('WHEN one is named like Props itself', () => {
    it('THEN it keeps the name, because Props is leaving', () => {
      expect(comingUpOutOfProps(['Props'], ['Characters'])).toEqual(['Props']);
    });
  });

  describe('WHEN one is named like a category already there', () => {
    it('THEN it is named after the category it came out of', () => {
      expect(comingUpOutOfProps(['Mobs'], ['Mobs'])).toEqual(['Mobs (from Props)']);
    });

    it('THEN the others keep their own names', () => {
      expect(comingUpOutOfProps(['Interior', 'Mobs', 'Exterior'], ['Mobs'])).toEqual([
        'Interior',
        'Mobs (from Props)',
        'Exterior',
      ]);
    });
  });

  describe('WHEN that name is taken as well', () => {
    it('THEN it is numbered, counting from two', () => {
      expect(
        comingUpOutOfProps(['Mobs'], ['Mobs', 'Mobs (from Props)', 'Mobs (from Props) 2']),
      ).toEqual(['Mobs (from Props) 3']);
    });
  });

  describe('WHEN one coming up is already called what another would be given', () => {
    it('THEN the one already called it keeps it, and the other is numbered', () => {
      expect(comingUpOutOfProps(['Mobs', 'Mobs (from Props)'], ['Mobs'])).toEqual([
        'Mobs (from Props) 2',
        'Mobs (from Props)',
      ]);
    });
  });

  describe('WHEN the name it would be given is longer than a category name may be', () => {
    const longest = 'M'.repeat(MAXIMUM_ASSET_CATEGORY_NAME_LENGTH);

    it('THEN it is cut to fit, and says it was cut', () => {
      const [given = ''] = comingUpOutOfProps([longest], [longest]);

      expect(given).toHaveLength(MAXIMUM_ASSET_CATEGORY_NAME_LENGTH);
      expect(given.endsWith('…')).toBe(true);
    });

    it('THEN a number survives the cut', () => {
      const [first = ''] = comingUpOutOfProps([longest], [longest]);
      const [second = ''] = comingUpOutOfProps([longest], [longest, first]);

      expect(second).toHaveLength(MAXIMUM_ASSET_CATEGORY_NAME_LENGTH);
      expect(second.endsWith('… 2')).toBe(true);
    });
  });
});
