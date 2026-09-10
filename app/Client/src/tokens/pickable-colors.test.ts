import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PICKABLE_COLOR,
  PICKABLE_COLORS,
  isAPickableColor,
  nameOfPickableColor,
} from './pickable-colors.js';

describe('GIVEN the colours somebody can put on a thing they made', () => {
  describe('WHEN one is sent to the server', () => {
    it('THEN it is the lower-case six-digit hex the command schemas accept', () => {
      const wrong = PICKABLE_COLORS.filter((color) => !/^#[0-9a-f]{6}$/.test(color.value));

      expect(wrong).toEqual([]);
    });
  });

  describe('WHEN two of them are drawn beside each other', () => {
    it('THEN no colour is offered twice, so the grid has no dead swatch', () => {
      expect(new Set(PICKABLE_COLORS.map((color) => color.value)).size).toBe(
        PICKABLE_COLORS.length,
      );
    });

    it('THEN no two share a name, so a screen reader can tell them apart', () => {
      expect(new Set(PICKABLE_COLORS.map((color) => color.name)).size).toBe(PICKABLE_COLORS.length);
    });
  });

  describe('WHEN the six the board and the library used to offer are looked for', () => {
    it('THEN every one is still there, so nothing already chosen left the palette', () => {
      // A colour that leaves the list is a list or a category drawn in a colour
      // its own dialog cannot show as chosen.
      const wasOffered = [
        '#adadad',
        '#f0de8a',
        '#63aeeb',
        '#63eba3',
        '#eb7d73',
        '#c79bf0',
        '#cf9556',
        '#eda363',
      ];

      expect(wasOffered.filter((value) => !isAPickableColor(value))).toEqual([]);
    });
  });

  describe('WHEN a thing is made before anybody chooses a colour', () => {
    it('THEN the default is one the picker offers', () => {
      expect(isAPickableColor(DEFAULT_PICKABLE_COLOR)).toBe(true);
    });
  });
});

describe('GIVEN a colour that has to be said out loud', () => {
  describe('WHEN it is one of the offered ones', () => {
    it('THEN it is called by its name', () => {
      expect(nameOfPickableColor('#63aeeb')).toBe('Blue');
    });

    it('THEN the case it arrives in does not matter', () => {
      expect(nameOfPickableColor('#63AEEB')).toBe('Blue');
      expect(isAPickableColor('#63AEEB')).toBe(true);
    });
  });

  describe('WHEN it is one somebody mixed', () => {
    it('THEN it is called by its hex, because two mixed colours are two colours', () => {
      expect(nameOfPickableColor('#3F7D5A')).toBe('#3f7d5a');
      expect(isAPickableColor('#3f7d5a')).toBe(false);
    });
  });
});
