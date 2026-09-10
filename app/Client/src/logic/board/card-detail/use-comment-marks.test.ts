import { describe, expect, it } from 'vitest';

import { readMarkBeingTyped, replaceMarkBeingTyped } from './use-comment-marks.js';

const MIRA = '018f0000-0000-7000-8000-000000000001';

describe('GIVEN somebody typing a comment', () => {
  describe('WHEN the caret is in a word that began with a sigil', () => {
    it('THEN the picker opens on that word', () => {
      const body = 'have a look @mi';

      expect(readMarkBeingTyped(body, body.length)).toEqual({
        sigil: '@',
        query: 'mi',
        from: 12,
      });
    });

    it('THEN a sigil at the very start counts', () => {
      expect(readMarkBeingTyped('@mi', 3)).toMatchObject({ sigil: '@', query: 'mi' });
    });

    it('THEN the last sigil is the one in play', () => {
      const body = 'ask @mira about #wat';

      expect(readMarkBeingTyped(body, body.length)).toMatchObject({ sigil: '#', query: 'wat' });
    });

    it('THEN a bare sigil offers everybody, before anything is typed', () => {
      expect(readMarkBeingTyped('tell @', 6)).toMatchObject({ sigil: '@', query: '' });
    });
  });

  describe('WHEN the caret is not in one', () => {
    it('THEN an email address is an address', () => {
      // The common case, and the one that would be most annoying to get wrong.
      const body = 'email jake@northwind.studio';

      expect(readMarkBeingTyped(body, body.length)).toBeNull();
    });

    it('THEN a finished word is finished', () => {
      const body = '@mira has it';

      expect(readMarkBeingTyped(body, body.length)).toBeNull();
    });

    it('THEN a mark already written is not being typed', () => {
      const body = `@[Mira Kaur](user:${MIRA})`;

      expect(readMarkBeingTyped(body, body.length)).toBeNull();
    });

    it('THEN plain prose opens nothing', () => {
      expect(readMarkBeingTyped('the deck is wrong', 17)).toBeNull();
    });
  });

  describe('WHEN one is chosen from the picker', () => {
    it('THEN it replaces the run, and the caret waits after it', () => {
      const body = 'have a look @mi';
      const typed = readMarkBeingTyped(body, body.length);

      const next = replaceMarkBeingTyped(body, typed ?? { sigil: '@', query: '', from: 0 }, {
        kind: 'user',
        id: MIRA,
        label: 'Mira Kaur',
      });

      expect(next.body).toBe(`have a look @[Mira Kaur](user:${MIRA}) `);
      // After the mark and the space, because the next thing typed is the rest
      // of the sentence.
      expect(next.caret).toBe(next.body.length);
    });

    it('THEN a name chosen mid-sentence does not leave a gap behind it', () => {
      const body = 'ask @mi to check it';
      const typed = readMarkBeingTyped(body, 7);

      const next = replaceMarkBeingTyped(body, typed ?? { sigil: '@', query: '', from: 0 }, {
        kind: 'user',
        id: MIRA,
        label: 'Mira Kaur',
      });

      expect(next.body).toBe(`ask @[Mira Kaur](user:${MIRA}) to check it`);
    });
  });
});
