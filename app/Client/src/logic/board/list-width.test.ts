import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LIST_WIDTH,
  NARROWEST_LIST_WIDTH,
  WIDEST_LIST_WIDTH,
  keepListWidthUsable,
  listWidthAfterKey,
  readListWidth,
} from './list-width.js';

describe('GIVEN somebody is dragging the edge of a column', () => {
  describe('WHEN they drag it to a width that suits them', () => {
    it('THEN takes it as it is, to the pixel', () => {
      expect(keepListWidthUsable(340)).toBe(340);
    });
  });

  describe('WHEN they drag it narrower than a card can be read at', () => {
    it('THEN stops at the narrowest that stays readable', () => {
      expect(keepListWidthUsable(40)).toBe(NARROWEST_LIST_WIDTH);
    });
  });

  describe('WHEN they drag it wider than the board', () => {
    it('THEN stops at the widest, so the columns stay countable', () => {
      expect(keepListWidthUsable(4000)).toBe(WIDEST_LIST_WIDTH);
    });
  });

  describe('WHEN the drag lands between two pixels', () => {
    it('THEN keeps whole ones, because a column is drawn in them', () => {
      expect(keepListWidthUsable(262.4)).toBe(262);
    });
  });
});

describe('GIVEN a width that was kept from last time', () => {
  describe('WHEN nothing was ever kept', () => {
    it('THEN opens the board at the width everybody else opens it at', () => {
      expect(readListWidth(null)).toBe(DEFAULT_LIST_WIDTH);
    });
  });

  describe('WHEN one was kept', () => {
    it('THEN opens the board where they left it', () => {
      expect(readListWidth('318')).toBe(318);
    });
  });

  describe('WHEN what was kept is not a number', () => {
    /*
     * Storage is a string somebody could have edited by hand, and an empty one
     * is the trap: `Number('')` is 0, so anything that only asked whether the
     * value parsed would clamp it to the narrowest column and call that a
     * preference.
     */
    it.each([
      { description: 'nothing at all', stored: '' },
      { description: 'a blank', stored: ' ' },
      { description: 'words', stored: 'wide please' },
      { description: 'the word NaN', stored: 'NaN' },
    ])('THEN falls back to the default for $description', ({ stored }) => {
      expect(readListWidth(stored)).toBe(DEFAULT_LIST_WIDTH);
    });
  });

  describe('WHEN what was kept is outside what is now allowed', () => {
    it('THEN brings it back inside rather than refusing it', () => {
      expect(readListWidth('9000')).toBe(WIDEST_LIST_WIDTH);
    });
  });
});

describe('GIVEN somebody is setting the width from the keyboard', () => {
  describe('WHEN they press the arrows', () => {
    it('THEN moves the edge by a step they can see', () => {
      expect(listWidthAfterKey(262, 'ArrowRight')).toBe(278);
      expect(listWidthAfterKey(262, 'ArrowLeft')).toBe(246);
    });
  });

  describe('WHEN the arrows would take it past a bound', () => {
    it('THEN stops there, the same as a drag does', () => {
      expect(listWidthAfterKey(NARROWEST_LIST_WIDTH, 'ArrowLeft')).toBe(NARROWEST_LIST_WIDTH);
      expect(listWidthAfterKey(WIDEST_LIST_WIDTH, 'ArrowRight')).toBe(WIDEST_LIST_WIDTH);
    });
  });

  describe('WHEN they press Home', () => {
    /*
     * The keyboard's way back. A mouse gets it by pressing the edge twice, and
     * without this somebody who dragged to 301 could arrow in sixteens forever
     * and never land on the default again.
     */
    it('THEN puts the width back to the default exactly', () => {
      expect(listWidthAfterKey(301, 'Home')).toBe(DEFAULT_LIST_WIDTH);
    });
  });

  describe('WHEN they press End', () => {
    it('THEN goes straight to the widest', () => {
      expect(listWidthAfterKey(262, 'End')).toBe(WIDEST_LIST_WIDTH);
    });
  });

  describe('WHEN they press anything else', () => {
    it('THEN answers with nothing, so the key does what it always did', () => {
      expect(listWidthAfterKey(262, 'Enter')).toBeNull();
      expect(listWidthAfterKey(262, 'ArrowUp')).toBeNull();
    });
  });
});
