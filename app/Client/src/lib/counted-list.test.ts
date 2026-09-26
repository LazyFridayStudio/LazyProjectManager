import { describe, expect, it } from 'vitest';

import { asList, countOf } from './counted-list.js';

describe('GIVEN the parts of a sentence saying what goes with something', () => {
  describe('WHEN a count is said', () => {
    it('THEN none of something is left out rather than said', () => {
      expect(countOf(0, 'stage', 'stages')).toBeNull();
    });

    it('THEN one takes the singular', () => {
      expect(countOf(1, 'stage', 'stages')).toBe('1 stage');
    });

    it('THEN more than one takes the plural', () => {
      expect(countOf(3, 'stage', 'stages')).toBe('3 stages');
    });
  });

  describe('WHEN the parts are joined', () => {
    it('THEN one part stands alone', () => {
      expect(asList(['2 tags'])).toBe('2 tags');
    });

    it('THEN two are joined with "and"', () => {
      expect(asList(['2 tags', '1 stage'])).toBe('2 tags and 1 stage');
    });

    it('THEN more take commas, and "and" before the last', () => {
      expect(asList(['2 tags', '1 stage', '4 files'])).toBe('2 tags, 1 stage and 4 files');
    });
  });
});
