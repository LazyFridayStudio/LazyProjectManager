import { describe, expect, it } from 'vitest';

import { resolveDrop } from './resolve-drop.js';

const SHEET = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));

/** What the strip would look like afterwards, which is what a drag promises. */
function orderAfter(activeId: string, overId: string): readonly string[] {
  return resolveDrop(SHEET, activeId, overId)?.order ?? [];
}

describe('GIVEN a hand-ordered list being reordered by dragging', () => {
  describe('WHEN one is dragged backwards, towards the front', () => {
    it('THEN it lands where the picture it was dropped on was', () => {
      expect(orderAfter('d', 'b')).toEqual(['a', 'd', 'b', 'c', 'e']);
    });

    it('THEN its neighbours are the pictures either side of where it landed', () => {
      expect(resolveDrop(SHEET, 'd', 'b')).toMatchObject({
        afterId: 'a',
        beforeId: 'b',
      });
    });

    it('THEN dropping on the first one makes it the thumbnail', () => {
      // The front of the sheet is what the library tile draws, so this is the
      // same act as pressing the offer in the corner.
      expect(resolveDrop(SHEET, 'e', 'a')).toMatchObject({
        afterId: null,
        beforeId: 'a',
      });
      expect(orderAfter('e', 'a')).toEqual(['e', 'a', 'b', 'c', 'd']);
    });
  });

  describe('WHEN one is dragged forwards, towards the back', () => {
    it('THEN it lands where the picture it was dropped on was, not after it', () => {
      // The off-by-one this had: dragging forwards put the picture one place
      // further on than where it was dropped, so it worked backwards and not
      // forwards.
      expect(orderAfter('a', 'c')).toEqual(['b', 'c', 'a', 'd', 'e']);
    });

    it('THEN its neighbours are the pictures either side of where it landed', () => {
      expect(resolveDrop(SHEET, 'a', 'c')).toMatchObject({
        afterId: 'c',
        beforeId: 'd',
      });
    });

    it('THEN dropping on the last one puts it last', () => {
      expect(resolveDrop(SHEET, 'a', 'e')).toMatchObject({
        afterId: 'e',
        beforeId: null,
      });
      expect(orderAfter('a', 'e')).toEqual(['b', 'c', 'd', 'e', 'a']);
    });
  });

  describe('WHEN the drop changes nothing', () => {
    it('THEN a picture dropped on itself is not a move', () => {
      expect(resolveDrop(SHEET, 'c', 'c')).toBeNull();
    });

    it('THEN a drop on something that is not on this sheet is not a move', () => {
      expect(resolveDrop(SHEET, 'c', 'zzz')).toBeNull();
    });

    it('THEN dragging something that is not on this sheet is not a move', () => {
      expect(resolveDrop(SHEET, 'zzz', 'c')).toBeNull();
    });
  });

  describe('WHEN there are only two pictures', () => {
    const pair = [{ id: 'a' }, { id: 'b' }];

    it('THEN they swap either way round', () => {
      expect(resolveDrop(pair, 'b', 'a')?.order).toEqual(['b', 'a']);
      expect(resolveDrop(pair, 'a', 'b')?.order).toEqual(['b', 'a']);
    });
  });
});
