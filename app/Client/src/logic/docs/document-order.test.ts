import { describe, expect, it } from 'vitest';

import { neighboursAfterMove, neighboursAfterStep } from './document-order.js';

/** A studio's row of documents, in the order they happened to be made. */
const ROW = ['brief', 'audio', 'pitch'];

describe('GIVEN a row of documents somebody wants in another order', () => {
  describe('WHEN one is dragged to the front', () => {
    it('THEN it lands in front of the first, with nothing behind it', () => {
      expect(neighboursAfterMove(ROW, 'pitch', 0)).toEqual({
        beforeDocId: 'brief',
        afterDocId: null,
      });
    });
  });

  describe('WHEN one is dragged to the end', () => {
    it('THEN it lands behind the last, with nothing in front of it', () => {
      expect(neighboursAfterMove(ROW, 'brief', 2)).toEqual({
        beforeDocId: null,
        afterDocId: 'pitch',
      });
    });
  });

  describe('WHEN one is dragged into the middle', () => {
    it('THEN it names both the document it is in front of and the one behind', () => {
      expect(neighboursAfterMove(ROW, 'pitch', 1)).toEqual({
        beforeDocId: 'audio',
        afterDocId: 'brief',
      });
    });
  });

  describe('WHEN it is dropped where it already was', () => {
    /*
     * A command for a move that changes nothing is a write, an invalidation and
     * a refetch to leave the screen exactly as it was — and on a row of tabs
     * that is every drag somebody thinks better of halfway.
     */
    it('THEN there is nothing to send', () => {
      expect(neighboursAfterMove(ROW, 'audio', 1)).toBeNull();
    });
  });

  describe('WHEN the document is not in the row', () => {
    it('THEN there is nothing to send', () => {
      expect(neighboursAfterMove(ROW, 'deleted', 0)).toBeNull();
    });
  });
});

describe('GIVEN somebody pressing a document one place along', () => {
  describe('WHEN they press it left', () => {
    it('THEN it swaps with the one before it', () => {
      expect(neighboursAfterStep(ROW, 'audio', -1)).toEqual({
        beforeDocId: 'brief',
        afterDocId: null,
      });
    });
  });

  describe('WHEN they press it right', () => {
    it('THEN it swaps with the one after it', () => {
      expect(neighboursAfterStep(ROW, 'audio', 1)).toEqual({
        beforeDocId: null,
        afterDocId: 'pitch',
      });
    });
  });

  describe('WHEN it is already at the end it is being pressed towards', () => {
    /*
     * Nothing, rather than the row wrapping around. A tab that jumped from the
     * end to the front would be a press nobody meant, and the two ends are
     * where somebody stops pressing.
     */
    it('THEN nothing happens', () => {
      expect(neighboursAfterStep(ROW, 'brief', -1)).toBeNull();
      expect(neighboursAfterStep(ROW, 'pitch', 1)).toBeNull();
    });
  });
});

describe('GIVEN a row of one document', () => {
  describe('WHEN it is pressed either way', () => {
    it('THEN nothing happens, because there is nowhere to put it', () => {
      expect(neighboursAfterStep(['only'], 'only', -1)).toBeNull();
      expect(neighboursAfterStep(['only'], 'only', 1)).toBeNull();
    });
  });
});
