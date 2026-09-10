import { describe, expect, it } from 'vitest';

import { cardTypes, colorByCardType, getColorForCardType } from './card-type-colors.js';

describe('GIVEN the card type colours', () => {
  describe('WHEN a type is looked up', () => {
    it('THEN it returns the chip colour the board reads at a glance', () => {
      expect(getColorForCardType('art')).toBe('#eda363');
      expect(getColorForCardType('task')).toBe('#63aeeb');
      expect(getColorForCardType('bug')).toBe('#eb7d73');
      expect(getColorForCardType('build')).toBe('#63eba3');
    });
  });

  describe('WHEN every declared type is checked', () => {
    it('THEN each has a colour, so no card can render without a chip', () => {
      expect(cardTypes.every((cardType) => getColorForCardType(cardType).length > 0)).toBe(true);
    });

    it('THEN the colours are distinct, so the types stay tellable apart', () => {
      expect(new Set(Object.values(colorByCardType)).size).toBe(cardTypes.length);
    });
  });
});
