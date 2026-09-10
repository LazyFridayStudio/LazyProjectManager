import { describe, expect, it } from 'vitest';

import { slugify } from './slugify.js';

const OPTIONS = { fallback: 'thing', maximumLength: 60 };

describe('GIVEN a name being turned into a URL slug', () => {
  describe('WHEN it is ordinary words', () => {
    it('THEN it lowercases and joins them with a single separator', () => {
      expect(slugify('Harbour Night', OPTIONS)).toBe('harbour-night');
    });

    it('THEN every run of punctuation collapses to one separator', () => {
      expect(slugify('Saltmarsh (prototype) — v2', OPTIONS)).toBe('saltmarsh-prototype-v2');
    });

    it('THEN leading and trailing separators are removed', () => {
      expect(slugify('  --Kiln--  ', OPTIONS)).toBe('kiln');
    });
  });

  describe('WHEN it carries diacritics', () => {
    it('THEN the letter survives rather than the whole vowel being dropped', () => {
      expect(slugify('Ötzi Interactive', OPTIONS)).toBe('otzi-interactive');
    });
  });

  describe('WHEN it is longer than the limit', () => {
    it('THEN it is cut to the limit and never left ending in a separator', () => {
      const slug = slugify('drowned reach', { fallback: 'thing', maximumLength: 8 });

      expect(slug).toBe('drowned');
      expect(slug.length).toBeLessThanOrEqual(8);
    });
  });

  describe('WHEN it has no characters a URL can carry', () => {
    it('THEN the fallback is used instead of an empty address', () => {
      expect(slugify('★★★', OPTIONS)).toBe('thing');
      expect(slugify('', OPTIONS)).toBe('thing');
    });
  });
});
