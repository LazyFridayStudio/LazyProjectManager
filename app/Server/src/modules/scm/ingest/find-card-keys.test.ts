import { describe, expect, it } from 'vitest';

import { findCardKeys } from './find-card-keys.js';

const CODE = 'LPMT';

describe('GIVEN something somebody wrote in a repository', () => {
  describe('WHEN it names a card', () => {
    it('THEN the key is found wherever it sits in the line', () => {
      expect(findCardKeys('LPMT-ART-1 block out the harbour crane', CODE)).toEqual(['LPMT-ART-1']);
      expect(findCardKeys('fix: lower the LOD threshold (LPMT-TASK-1)', CODE)).toEqual([
        'LPMT-TASK-1',
      ]);
    });

    it('THEN it is found however it was typed', () => {
      // A key is a key in lower case. Nobody holds shift for a commit message.
      expect(findCardKeys('fixes lpmt-bug-3', CODE)).toEqual(['LPMT-BUG-3']);
    });

    it('THEN every card it names is found, not only the first', () => {
      const message = 'Both LPMT-ART-1 and LPMT-TASK-1 move on this one.';

      expect(findCardKeys(message, CODE)).toEqual(['LPMT-ART-1', 'LPMT-TASK-1']);
    });

    it('THEN naming the same card twice is still one card', () => {
      expect(findCardKeys('LPMT-ART-1, and again LPMT-ART-1', CODE)).toEqual(['LPMT-ART-1']);
    });

    it('THEN they come back in the order they were written', () => {
      expect(findCardKeys('LPMT-BUILD-2 then LPMT-ART-9', CODE)).toEqual([
        'LPMT-BUILD-2',
        'LPMT-ART-9',
      ]);
    });

    it('THEN a key in a branch name is found like any other text', () => {
      expect(findCardKeys('feature/LPMT-ART-2-crane-textures', CODE)).toEqual(['LPMT-ART-2']);
    });

    it('THEN a key in a URL is found, because that is still a mention', () => {
      expect(findCardKeys('see https://example.test/x/LPMT-BUG-4', CODE)).toEqual(['LPMT-BUG-4']);
    });
  });

  describe('WHEN it does not', () => {
    it('THEN a key without a number is not a key', () => {
      // `LPMT-TASK` is a label somebody wrote, not a card.
      expect(findCardKeys('docs: write LPMT-TASK somewhere', CODE)).toEqual([]);
    });

    it('THEN another project code is left alone', () => {
      expect(findCardKeys('this mentions SLTM-TASK-1, which is not ours', CODE)).toEqual([]);
    });

    it('THEN a type nothing issues keys for is not a key', () => {
      expect(findCardKeys('LPMT-CHORE-1 is not a thing', CODE)).toEqual([]);
    });

    it('THEN a key that is part of a longer token is a different token', () => {
      expect(findCardKeys('XLPMT-ART-1', CODE)).toEqual([]);
      expect(findCardKeys('LPMT-ART-1a', CODE)).toEqual([]);
    });

    it('THEN a shorter code does not match a longer one that starts with it', () => {
      // Project `LP` must not collect `LPMT`'s cards.
      expect(findCardKeys('LPMT-ART-1', 'LP')).toEqual([]);
    });

    it('THEN nothing at all is nothing', () => {
      expect(findCardKeys('', CODE)).toEqual([]);
      expect(findCardKeys('chore: the shape of a repository', CODE)).toEqual([]);
    });
  });

  describe('WHEN the project code contains something a pattern would read', () => {
    it('THEN it is matched as text rather than as an expression', () => {
      // Codes are letters and digits today, but a regular expression built by
      // pasting one in is a hole waiting for the day they are not.
      expect(findCardKeys('A.C-ART-1', 'A.C')).toEqual(['A.C-ART-1']);
      expect(findCardKeys('ABC-ART-1', 'A.C')).toEqual([]);
    });
  });
});
