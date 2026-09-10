import { describe, expect, it } from 'vitest';

import { assetTagSchema } from './asset-vocabulary.js';

/** What the schema makes of what somebody typed. */
function normalise(typed: string): string | null {
  const parsed = assetTagSchema.safeParse(typed);

  return parsed.success ? parsed.data : null;
}

describe('GIVEN a tag somebody typed', () => {
  describe('WHEN it is read', () => {
    it('THEN case and spacing stop mattering, so one tag is one tag', () => {
      // A library where `Act 1`, `act 1` and `ACT-1` are three tags is a library
      // where filtering by any of them finds a third of what it should.
      expect(normalise('Act 1')).toBe('act-1');
      expect(normalise('  ACT_1  ')).toBe('act-1');
      expect(normalise('act--1')).toBe('act-1');
    });

    it('THEN the forms the design already uses come through untouched', () => {
      for (const tag of ['modular', 'stone', 'act-1', 'cloth-sim', 'phase-2', 'concept-only']) {
        expect(normalise(tag)).toBe(tag);
      }
    });

    it('THEN nothing that is not a word is accepted', () => {
      // A tag ends up in a URL and in a filter; punctuation in one is a tag
      // somebody has to guess the spelling of.
      expect(normalise('')).toBeNull();
      expect(normalise('   ')).toBeNull();
      expect(normalise('-leading')).toBeNull();
      expect(normalise('what?')).toBeNull();
      expect(normalise('a'.repeat(41))).toBeNull();
    });

    it('THEN one at the limit is still a tag', () => {
      expect(normalise('a'.repeat(40))).toBe('a'.repeat(40));
    });
  });
});
