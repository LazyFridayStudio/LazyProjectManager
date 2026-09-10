import { describe, expect, it } from 'vitest';

import { deriveAccountSlug } from './account-slug.js';
import { deriveInitials } from './derive-initials.js';
import { calculateSessionExpiry, isSessionExpired } from './session-lifetime.js';

describe('GIVEN a display name to draw on a card avatar', () => {
  describe('WHEN it has a given name and a surname', () => {
    it('THEN the initials are the first letter of each', () => {
      expect(deriveInitials('Jake Winters')).toBe('JW');
    });
  });

  describe('WHEN it has several middle names', () => {
    it('THEN only the first and last are used', () => {
      expect(deriveInitials('Mira De La Cruz')).toBe('MC');
    });
  });

  describe('WHEN it is a single word', () => {
    it('THEN two letters are taken from it', () => {
      // One capital in a 22px avatar reads as a mistake rather than a monogram.
      expect(deriveInitials('Taro')).toBe('TA');
    });
  });

  describe('WHEN the surname is hyphenated', () => {
    it('THEN it counts as one name', () => {
      // Ruiz-Mendez is a single surname, so its initial is R. Splitting on the
      // hyphen would give AM, which is not how anyone writes their initials.
      expect(deriveInitials('Ana Ruiz-Mendez')).toBe('AR');
    });
  });

  describe('WHEN it carries punctuation or extra spacing', () => {
    it('THEN the punctuation is skipped rather than sliced into the initials', () => {
      expect(deriveInitials('(Jake) Winters')).toBe('JW');
      expect(deriveInitials('  Jake   Winters  ')).toBe('JW');
    });
  });

  describe('WHEN it is written in a non-Latin script', () => {
    it('THEN the letters are kept', () => {
      expect(deriveInitials('Ötzi Ürgen')).toBe('ÖÜ');
      expect(deriveInitials('田中 太郎')).toBe('田太');
    });
  });

  describe('WHEN it contains no letters at all', () => {
    it('THEN a placeholder is returned, never an empty string', () => {
      // The column is NOT NULL and a blank avatar reads as a rendering bug.
      expect(deriveInitials('')).toBe('?');
      expect(deriveInitials('   ')).toBe('?');
      expect(deriveInitials('!!!')).toBe('?');
      expect(deriveInitials('🙂')).toBe('?');
    });
  });
});

describe('GIVEN a studio name to turn into an account slug', () => {
  describe('WHEN it is ordinary words', () => {
    it('THEN it lowercases and joins them with hyphens', () => {
      expect(deriveAccountSlug('Northwind Studio')).toBe('northwind-studio');
    });
  });

  describe('WHEN it carries diacritics', () => {
    it('THEN the marks are stripped and the letter survives', () => {
      expect(deriveAccountSlug('Ötzi Games')).toBe('otzi-games');
    });
  });

  describe('WHEN it starts or ends with punctuation', () => {
    it('THEN the slug has no leading or trailing hyphen', () => {
      expect(deriveAccountSlug('  !Northwind!  ')).toBe('northwind');
    });
  });

  describe('WHEN it has nothing sluggable in it', () => {
    it('THEN a usable fallback is returned', () => {
      expect(deriveAccountSlug('!!!')).toBe('studio');
      expect(deriveAccountSlug('')).toBe('studio');
    });
  });
});

describe('GIVEN a session that was just issued', () => {
  describe('WHEN its expiry is calculated', () => {
    it('THEN it falls thirty days later', () => {
      const issuedAt = new Date('2026-08-18T00:00:00.000Z');

      expect(calculateSessionExpiry(issuedAt).toISOString()).toBe('2026-09-17T00:00:00.000Z');
    });
  });

  describe('WHEN the clock reaches the exact expiry instant', () => {
    it('THEN the session counts as expired', () => {
      const expiresAt = new Date('2026-09-17T00:00:00.000Z');

      expect(isSessionExpired(expiresAt, expiresAt)).toBe(true);
    });
  });

  describe('WHEN there is still a millisecond left', () => {
    it('THEN the session is still valid', () => {
      const expiresAt = new Date('2026-09-17T00:00:00.000Z');

      expect(isSessionExpired(expiresAt, new Date('2026-09-16T23:59:59.999Z'))).toBe(false);
    });
  });
});
