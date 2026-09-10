import { describe, expect, it } from 'vitest';
import type { AssetLibraryView } from '@lpm/shared';

import {
  categoryIdOfHeading,
  collisionsInLibrary,
  describeCategoryPlacement,
  describeDrop,
  headingIdOf,
  headingsStepAside,
  isWhereItStarted,
  rowIdOf,
} from './category-drag.js';

/**
 * Where a dragged heading says it should go.
 *
 * Pure arithmetic over the view the screen is holding, the way a tile's drag
 * is: this is the half that can be wrong without anything throwing, and the
 * half a person would only find by dropping a category and watching the library
 * come back in a different order.
 */
describe('GIVEN a heading and the id it is dragged under', () => {
  describe('WHEN a category is given one', () => {
    it('THEN the category can be read back out of it', () => {
      expect(categoryIdOfHeading(headingIdOf('props'))).toBe('props');
    });
  });

  describe('WHEN something that is not a heading is asked about', () => {
    it('THEN it says so, which is how a tile drag is told from a heading drag', () => {
      // A category is a droppable under its own id as well — the open space a
      // tile lands in — so the two have to be distinguishable by id alone.
      expect(categoryIdOfHeading('props')).toBeNull();
    });
  });
});

describe('GIVEN a heading carried over another', () => {
  /**
   * ```
   * props
   *   interior
   *   exterior
   * characters
   * ```
   */
  function nested(): AssetLibraryView {
    const leaf = (id: string, categories: unknown[] = []) => ({
      id,
      name: id,
      color: '#adadad',
      budgetMinor: null,
      count: 0,
      estimatedMinor: 0,
      categories,
      assets: [],
    });

    return {
      project: {
        id: 'p',
        name: 'Drowned Reach',
        slug: 'drowned-reach',
        currency: 'AUD',
        archived: false,
      },
      categories: [leaf('props', [leaf('interior'), leaf('exterior')]), leaf('characters')],
    } as unknown as AssetLibraryView;
  }

  describe('WHEN it is let go on the middle of a row', () => {
    it('THEN it goes inside, after whatever is already in there', () => {
      expect(
        describeDrop(nested(), { moved: 'characters', onto: 'props', band: 'inside' }),
      ).toEqual({
        categoryId: 'characters',
        parentId: 'props',
        beforeCategoryId: null,
        afterCategoryId: 'exterior',
      });
    });

    it('THEN a sub-category goes inside a sub-category, however deep', () => {
      // The move a flat library never had: dropping one heading on another used
      // to make them siblings, so the only way into a category was to aim at
      // something already in it.
      expect(
        describeDrop(nested(), { moved: 'characters', onto: 'interior', band: 'inside' }),
      ).toMatchObject({ parentId: 'interior', afterCategoryId: null });
    });

    it('THEN one already last in there is asked for nothing', () => {
      expect(
        describeDrop(nested(), { moved: 'exterior', onto: 'props', band: 'inside' }),
      ).toMatchObject({ parentId: 'props', afterCategoryId: 'interior' });
    });
  });

  describe('WHEN it is let go on the top edge of a row', () => {
    it('THEN it lands above that heading, among the same categories', () => {
      expect(
        describeDrop(nested(), { moved: 'characters', onto: 'exterior', band: 'before' }),
      ).toEqual({
        categoryId: 'characters',
        parentId: 'props',
        beforeCategoryId: 'exterior',
        afterCategoryId: 'interior',
      });
    });

    it('THEN above the first of them names nothing behind it', () => {
      expect(
        describeDrop(nested(), { moved: 'characters', onto: 'props', band: 'before' }),
      ).toEqual({
        categoryId: 'characters',
        parentId: null,
        beforeCategoryId: 'props',
        afterCategoryId: null,
      });
    });
  });

  describe('WHEN it is let go on the bottom edge of a row', () => {
    it('THEN it lands below that heading', () => {
      expect(
        describeDrop(nested(), { moved: 'characters', onto: 'interior', band: 'after' }),
      ).toEqual({
        categoryId: 'characters',
        parentId: 'props',
        beforeCategoryId: 'exterior',
        afterCategoryId: 'interior',
      });
    });

    it('THEN the neighbours are read without the one being carried', () => {
      // Dropped just below where it already is, it would otherwise be told to
      // go after itself.
      expect(
        describeDrop(nested(), { moved: 'interior', onto: 'exterior', band: 'after' }),
      ).toEqual({
        categoryId: 'interior',
        parentId: 'props',
        beforeCategoryId: null,
        afterCategoryId: 'exterior',
      });
    });
  });

  describe('WHEN the drop could not be made', () => {
    it('THEN a heading dropped on itself asks for nothing', () => {
      expect(describeDrop(nested(), { moved: 'props', onto: 'props', band: 'inside' })).toBeNull();
    });

    it('THEN a heading cannot be put inside its own branch', () => {
      // A subtree that has left the library: nothing could reach it, and no
      // walk over the tree would end.
      expect(
        describeDrop(nested(), { moved: 'props', onto: 'interior', band: 'inside' }),
      ).toBeNull();
      expect(
        describeDrop(nested(), { moved: 'props', onto: 'interior', band: 'before' }),
      ).toBeNull();
    });
  });

  describe('WHEN where a nested heading sits is read off the library', () => {
    it('THEN it is named among its own siblings, not the whole library', () => {
      expect(describeCategoryPlacement(nested(), 'exterior')).toEqual({
        categoryId: 'exterior',
        parentId: 'props',
        beforeCategoryId: null,
        afterCategoryId: 'interior',
      });
    });

    it('THEN a drop that names the same place is one the server is not asked for', () => {
      const move = describeDrop(nested(), { moved: 'exterior', onto: 'interior', band: 'after' });

      expect(move !== null && isWhereItStarted(nested(), move)).toBe(true);
    });
  });
});

describe('GIVEN a heading carried over a library of indented rows', () => {
  /**
   * Two rows, one inside the other, as the screen lays them out.
   *
   * A row is indented by how deep its category sits, so the deeper one starts
   * further right — which is the whole point of this: the pointer is in the
   * shallow one's column, because that is where the grip it was picked up by
   * lives.
   */
  const ROWS: Record<string, { top: number; left: number }> = {
    shallow: { top: 100, left: 238 },
    deep: { top: 200, left: 278 },
  };

  function row(name: string) {
    const sits = ROWS[name] ?? { top: 0, left: 0 };
    const rect = {
      top: sits.top,
      bottom: sits.top + 46,
      height: 46,
      left: sits.left,
      right: 1258,
      width: 1258 - sits.left,
    };

    return {
      id: rowIdOf(name),
      key: rowIdOf(name),
      data: { current: undefined },
      disabled: false,
      node: { current: { getBoundingClientRect: () => rect } },
      rect: { current: rect },
    };
  }

  function carrying(name: string, pointer: { x: number; y: number }) {
    return collisionsInLibrary({
      active: {
        id: headingIdOf(name),
        data: { current: undefined },
        rect: { current: { initial: null, translated: null } },
      },
      collisionRect: {
        top: pointer.y,
        bottom: pointer.y,
        left: pointer.x,
        right: pointer.x,
        width: 0,
        height: 0,
      },
      droppableRects: new Map(
        ['shallow', 'deep'].map((name) => [rowIdOf(name), row(name).rect.current]),
      ),
      droppableContainers: [row('shallow'), row('deep')],
      pointerCoordinates: pointer,
    } as never);
  }

  describe('WHEN the pointer is over a deeper row but still in its own column', () => {
    it('THEN that deeper row is what it would land on', () => {
      // A heading picked up by its grip is dragged straight down the column it
      // came from. Asking the pointer to be inside the row horizontally meant
      // it could never reach anything deeper than itself.
      const landed = carrying('shallow', { x: 247, y: 223 });

      expect(landed[0]?.id).toBe(headingIdOf('deep'));
      expect(landed[0]?.data).toEqual({ band: 'inside' });
    });
  });

  describe('WHEN the pointer is at the top of a row', () => {
    it('THEN it would land above it', () => {
      expect(carrying('deep', { x: 247, y: 103 })[0]?.data).toEqual({ band: 'before' });
    });
  });

  describe('WHEN the pointer is at the bottom of a row', () => {
    it('THEN it would land below it', () => {
      expect(carrying('deep', { x: 247, y: 143 })[0]?.data).toEqual({ band: 'after' });
    });
  });

  describe('WHEN the row under the pointer is the one being carried', () => {
    it('THEN the nearest other row answers instead, and only beside itself', () => {
      // Its own row is never a candidate: nothing goes inside itself, and while
      // it is being carried it is the row most often under the pointer.
      const landed = carrying('deep', { x: 247, y: 223 });

      expect(landed[0]?.id).toBe(headingIdOf('shallow'));
      expect(landed[0]?.data).toEqual({ band: 'after' });
    });
  });
});

describe('GIVEN the headings of a library', () => {
  describe('WHEN anything at all is being carried', () => {
    it('THEN they stay still, because the library is redrawn instead', () => {
      // Sliding the rows around and rewriting the tree are the same move made
      // twice, and a section is as tall as everything it holds.
      expect(headingsStepAside({ activeIndex: -1 } as never)).toBeNull();
      expect(headingsStepAside({ activeIndex: 2, overIndex: 0 } as never)).toBeNull();
    });
  });
});
