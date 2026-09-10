import { describe, expect, it } from 'vitest';

import type { ClientRect, DroppableContainer } from '@dnd-kit/core';

import {
  CATEGORY_DROPPABLE,
  describeAssetPlacement,
  isWhereItStarted,
  overTheTiles,
  resolveAssetDrop,
  tileDroppable,
  tilesStepAside,
} from './asset-drag.js';
import type { AssetLibraryView } from '@lpm/shared';

import { headingIdOf } from './heading-id.js';

/**
 * Where a dragged asset says it should go.
 *
 * Pure arithmetic over the view the screen is holding, so it is tested
 * directly — this is the half of a drag that can be wrong without anything
 * throwing, and the half a person would only find by dropping something and
 * watching it land in the wrong place.
 */

function tile(id: string): AssetLibraryView['categories'][number]['assets'][number] {
  return {
    id,
    name: id,
    status: 'concept',
    estimatedCostMinor: null,
    dueOn: null,
    primaryReferenceUrl: null,
    referenceCount: 0,
    linkedCardCount: 0,
    subtaskCount: 0,
    subtasksDone: 0,
    tags: [],
  };
}

function library(props: readonly string[], characters: readonly string[]): AssetLibraryView {
  return {
    project: {
      id: 'p',
      name: 'Drowned Reach',
      slug: 'drowned-reach',
      currency: 'AUD',
      archived: false,
    },
    categories: [
      {
        id: 'props',
        name: 'Props',
        color: '#adadad',
        budgetMinor: null,
        count: props.length,
        estimatedMinor: 0,
        categories: [],
        assets: props.map(tile),
      },
      {
        id: 'characters',
        name: 'Characters',
        color: '#adadad',
        budgetMinor: null,
        count: characters.length,
        estimatedMinor: 0,
        categories: [],
        assets: characters.map(tile),
      },
    ],
  } as unknown as AssetLibraryView;
}

const namesIn = (view: AssetLibraryView, categoryId: string): string[] =>
  view.categories.find((category) => category.id === categoryId)?.assets.map((asset) => asset.id) ??
  [];

describe('GIVEN an asset being dragged across the library', () => {
  describe('WHEN it is dropped among its own category', () => {
    it('THEN it takes the place of what it was dropped on', () => {
      const dropped = resolveAssetDrop(library(['a', 'b', 'c'], []), 'c', 'b');

      expect(namesIn(dropped?.next ?? library([], []), 'props')).toEqual(['a', 'c', 'b']);
      expect(dropped?.move).toMatchObject({ beforeAssetId: 'b', afterAssetId: 'a' });
    });

    it('THEN dragging the other way works too, which is where an off-by-one hides', () => {
      const dropped = resolveAssetDrop(library(['a', 'b', 'c'], []), 'a', 'c');

      expect(namesIn(dropped?.next ?? library([], []), 'props')).toEqual(['b', 'c', 'a']);
      expect(dropped?.move).toMatchObject({ beforeAssetId: null, afterAssetId: 'c' });
    });

    it('THEN dropping it on itself asks for nothing', () => {
      expect(resolveAssetDrop(library(['a', 'b'], []), 'a', 'a')).toBeNull();
    });

    it('THEN dropping it in the open space of its own category sends it to the end', () => {
      const dropped = resolveAssetDrop(library(['a', 'b', 'c'], []), 'a', 'props');

      expect(namesIn(dropped?.next ?? library([], []), 'props')).toEqual(['b', 'c', 'a']);
    });
  });

  describe('WHEN it is carried into another category', () => {
    it('THEN it lands where it was dropped rather than at the end', () => {
      const dropped = resolveAssetDrop(library(['a', 'b'], ['x', 'y']), 'a', 'y');

      expect(namesIn(dropped?.next ?? library([], []), 'characters')).toEqual(['x', 'a', 'y']);
      expect(dropped?.move).toMatchObject({
        toCategoryId: 'characters',
        beforeAssetId: 'y',
        afterAssetId: 'x',
      });
    });

    it('THEN it leaves the one it came from, because this is a move', () => {
      const dropped = resolveAssetDrop(library(['a', 'b'], ['x']), 'a', 'x');

      expect(namesIn(dropped?.next ?? library([], []), 'props')).toEqual(['b']);
    });

    it('THEN the counts follow it, so no heading claims a number it no longer has', () => {
      const dropped = resolveAssetDrop(library(['a', 'b'], ['x']), 'a', 'x');
      const counts = dropped?.next.categories.map((category) => category.count);

      // The heading is read while the drag is still in flight; a category
      // saying two while showing one is the small wrongness somebody notices.
      expect(counts).toEqual([1, 2]);
    });

    it('THEN dropping into an empty category puts it there', () => {
      const dropped = resolveAssetDrop(library(['a'], []), 'a', 'characters');

      expect(namesIn(dropped?.next ?? library([], []), 'characters')).toEqual(['a']);
      expect(dropped?.move).toMatchObject({
        toCategoryId: 'characters',
        beforeAssetId: null,
        afterAssetId: null,
      });
    });
  });

  describe('WHEN the drop makes no sense', () => {
    it('THEN nothing is asked for, rather than a command that would do nothing', () => {
      expect(resolveAssetDrop(library(['a'], []), 'nobody', 'a')).toBeNull();
      expect(resolveAssetDrop(library(['a'], []), 'a', 'nowhere')).toBeNull();
    });
  });
});

describe('GIVEN a drag has already put an asset where it is going', () => {
  /*
   * What the server is asked for is read off the library rather than worked out
   * from the drop event, because the tiles have been stepping aside all the way
   * across and the library is the only thing that knows where they ended up.
   */
  describe('WHEN it came to rest between two others', () => {
    it('THEN it is named by the assets either side of it', () => {
      expect(describeAssetPlacement(library(['a', 'b', 'c'], []), 'b')).toEqual({
        assetId: 'b',
        toCategoryId: 'props',
        beforeAssetId: 'c',
        afterAssetId: 'a',
      });
    });
  });

  describe('WHEN it came to rest at one end', () => {
    it('THEN the side with nothing on it is named as nothing', () => {
      expect(describeAssetPlacement(library(['a', 'b'], []), 'a')).toMatchObject({
        beforeAssetId: 'b',
        afterAssetId: null,
      });
      expect(describeAssetPlacement(library(['a', 'b'], []), 'b')).toMatchObject({
        beforeAssetId: null,
        afterAssetId: 'a',
      });
    });
  });

  describe('WHEN it is in a category it did not start in', () => {
    it('THEN that is the category asked for', () => {
      expect(describeAssetPlacement(library([], ['x', 'a']), 'a')).toMatchObject({
        toCategoryId: 'characters',
        afterAssetId: 'x',
      });
    });
  });

  describe('WHEN there is no such asset', () => {
    it('THEN nothing is asked for', () => {
      expect(describeAssetPlacement(library(['a'], []), 'nobody')).toBeNull();
    });
  });
});

describe('GIVEN a tile was picked up and let go again', () => {
  describe('WHEN it is exactly where it started', () => {
    it('THEN the server is not asked to move it', () => {
      const before = library(['a', 'b', 'c'], []);
      const placement = describeAssetPlacement(before, 'b');

      // Picking a tile up and putting it back is a drag like any other, and
      // asking for it writes an audit entry saying an asset moved when it did
      // not.
      expect(placement !== null && isWhereItStarted(before, placement)).toBe(true);
    });
  });

  describe('WHEN the drag actually moved it', () => {
    it('THEN the move is asked for', () => {
      const before = library(['a', 'b', 'c'], []);
      const dropped = resolveAssetDrop(before, 'c', 'a');
      const placement = describeAssetPlacement(dropped?.next ?? before, 'c');

      expect(placement !== null && isWhereItStarted(before, placement)).toBe(false);
    });
  });
});

/** Four tiles in a row, which is what a category's grid is to the strategy. */
const TILE_RECTS = [
  { left: 0, top: 0, width: 260, height: 200, right: 260, bottom: 200 },
  { left: 272, top: 0, width: 260, height: 200, right: 532, bottom: 200 },
  { left: 544, top: 0, width: 260, height: 200, right: 804, bottom: 200 },
  { left: 816, top: 0, width: 260, height: 200, right: 1076, bottom: 200 },
];

describe('GIVEN an asset is being carried across the library', () => {
  describe('WHEN it belongs to the category being asked', () => {
    it('THEN that category makes room for it', () => {
      const stepped = tilesStepAside({
        rects: TILE_RECTS,
        activeNodeRect: TILE_RECTS[1] ?? null,
        activeIndex: 1,
        overIndex: 3,
        index: 2,
      });

      expect(stepped).not.toBeNull();
    });
  });

  describe('WHEN it belongs to another category', () => {
    it('THEN this one stays exactly where it is', () => {
      const stepped = tilesStepAside({
        rects: TILE_RECTS,
        // The tile being carried is not one of these, so it has no index here.
        activeNodeRect: { left: 8, top: 400, width: 260, height: 200, right: 268, bottom: 600 },
        activeIndex: -1,
        overIndex: 1,
        index: 0,
      });

      // Every category is its own `SortableContext`, so all of them are asked
      // this for every drag. Answering laid the grid out around a tile that is
      // not in it, and the row slid sideways for a drag happening elsewhere.
      expect(stepped).toBeNull();
    });
  });
});

/*
 * One category holding three tiles in a row, with the gutters a real grid has.
 *
 * The category's own rect covers all of them, which is the whole difficulty:
 * the pointer is inside it for every drop, including the ones squarely on a
 * tile.
 */
const ROW_RECTS = new Map<string, ClientRect>([
  ['props', { left: 0, top: 100, width: 840, height: 220, right: 840, bottom: 320 }],
  ['first', { left: 12, top: 110, width: 260, height: 200, right: 272, bottom: 310 }],
  ['middle', { left: 284, top: 110, width: 260, height: 200, right: 544, bottom: 310 }],
  ['last', { left: 556, top: 110, width: 260, height: 200, right: 816, bottom: 310 }],
]);

function inTheRow(id: string): DroppableContainer {
  return {
    id,
    key: id,
    data: {
      current: id === 'props' ? CATEGORY_DROPPABLE : tileDroppable('props'),
    },
    disabled: false,
    node: { current: null },
    rect: { current: ROW_RECTS.get(id) ?? null },
  };
}

/**
 * The section around a category, which is what its heading is dragged by.
 *
 * It wraps everything the category holds, so it is under the pointer for every
 * drop into that category — which is why a tile has to say it is one rather
 * than being whatever is not a category.
 */
function theHeadingAround(id: string): DroppableContainer {
  return {
    id: `category-heading:${id}`,
    key: `category-heading:${id}`,
    data: { current: { sortable: { containerId: 'headings', index: 0, items: [] } } },
    disabled: false,
    node: { current: null },
    rect: { current: ROW_RECTS.get(id) ?? null },
  };
}

/** What a drop at this point would land on. */
function landingAt(atX: number, atY: number): string[] {
  // The carried tile travels with the pointer, so its rect does too — dnd-kit
  // measures distance from what is being dragged rather than from the pointer,
  // and moving one without the other asks about a drag that cannot happen.
  const carried: ClientRect = {
    left: atX - 130,
    top: atY - 100,
    width: 260,
    height: 200,
    right: atX + 130,
    bottom: atY + 100,
  };

  return overTheTiles({
    active: {
      id: 'last',
      data: { current: undefined },
      rect: { current: { initial: null, translated: null } },
    },
    collisionRect: carried,
    droppableRects: ROW_RECTS,
    droppableContainers: [
      theHeadingAround('props'),
      ...['props', 'first', 'middle', 'last'].map(inTheRow),
    ],
    pointerCoordinates: { x: atX, y: atY },
  }).map((collision) => String(collision.id));
}

/**
 * A category inside a category, as the browser lays them out.
 *
 * A heading is dragged by the section around it, so its droppable covers
 * everything the category holds — which means a pointer over a sub-category's
 * heading is inside its parent's heading droppable too, and inside its
 * grandparent's. The nearest one is the one being pointed at.
 */
const NESTED_RECTS = new Map<string, ClientRect>([
  // Keyed by the droppable's own id, which is what dnd-kit looks a rect up by.
  /*
   * Both the width of the screen, which is what makes this the hard case: their
   * centres are a few pixels apart, so "the nearest one" is decided by rounding.
   */
  // The whole of Blocks: its heading, Textures inside it, and its own tiles.
  [
    headingIdOf('blocks'),
    { left: 240, top: 100, width: 1018, height: 890, right: 1258, bottom: 990 },
  ],
  // Textures, a long way down inside it.
  [
    headingIdOf('textures'),
    { left: 260, top: 580, width: 998, height: 110, right: 1258, bottom: 690 },
  ],
]);

function headingSectionOf(id: string): DroppableContainer {
  return {
    id: headingIdOf(id),
    key: headingIdOf(id),
    data: { current: { sortable: { containerId: 'headings', index: 0, items: [] } } },
    disabled: false,
    node: { current: null },
    rect: { current: NESTED_RECTS.get(headingIdOf(id)) ?? null },
  };
}

function landingOnNested(atX: number, atY: number): string[] {
  const carried: ClientRect = {
    left: atX - 130,
    top: atY - 100,
    width: 260,
    height: 200,
    right: atX + 130,
    bottom: atY + 100,
  };

  return overTheTiles({
    active: {
      id: 'carried',
      data: { current: undefined },
      rect: { current: { initial: null, translated: null } },
    },
    collisionRect: carried,
    droppableRects: NESTED_RECTS,
    droppableContainers: [headingSectionOf('blocks'), headingSectionOf('textures')],
    pointerCoordinates: { x: atX, y: atY },
  }).map((collision) => String(collision.id));
}

describe('GIVEN a tile carried over a heading inside another heading', () => {
  describe('WHEN the pointer is on the inner heading', () => {
    it('THEN the inner one is what it would be dropped on', () => {
      // Both sections contain the pointer. Answering with the outer one would
      // file the asset one heading too high, which is the whole difficulty of
      // a library that nests.
      // Near the left edge on purpose: out here the *outer* section's centre is
      // the nearer of the two, so anything that trusts `pointerWithin`'s order
      // answers with the parent.
      expect(landingOnNested(382, 620)[0]).toBe(headingIdOf('textures'));
    });
  });

  describe('WHEN the pointer is on the outer heading, above everything inside it', () => {
    it('THEN the outer one is what it would be dropped on', () => {
      expect(landingOnNested(700, 130)[0]).toBe(headingIdOf('blocks'));
    });
  });
});

describe('GIVEN a tile is being carried over a row of them', () => {
  describe('WHEN the pointer is squarely on another tile', () => {
    it('THEN that tile is what it would be dropped on', () => {
      expect(landingAt(400, 200)[0]).toBe('middle');
    });

    it('THEN the category is not offered, though the pointer is inside it too', () => {
      // It is inside the category for every drop, so taking its answer would
      // mean every drop landed at the end of the row.
      expect(landingAt(400, 200)).not.toContain('props');
    });
  });

  describe('WHEN the pointer is in the margin before the first tile', () => {
    it('THEN the first tile is what it would be dropped on, so the front means the front', () => {
      expect(landingAt(5, 200)[0]).toBe('first');
    });
  });

  describe('WHEN the pointer is past the last tile', () => {
    it('THEN the last tile is what it would be dropped on', () => {
      expect(landingAt(830, 200)[0]).toBe('last');
    });
  });

  describe('WHEN the pointer is in the gutter between two', () => {
    it('THEN the nearer of them takes it, rather than the row as a whole', () => {
      expect(landingAt(278, 200)).not.toContain('props');
    });
  });

  describe('WHEN the section the category is dragged by is under the pointer too', () => {
    it('THEN it is never what a tile lands on, wherever the pointer is', () => {
      // It wraps the tiles, so it is under the pointer for every drop into this
      // category. A tile dropped onto the thing that reorders the headings
      // would be a tile that went nowhere.
      for (const [atX, atY] of [
        [400, 200],
        [5, 200],
        [830, 200],
        [278, 200],
      ] as const) {
        expect(landingAt(atX, atY)).not.toContain('category-heading:props');
      }
    });
  });
});

describe('GIVEN an asset in a library with categories inside categories', () => {
  /**
   * ```
   * props        [crate]
   *   interior   [chair, lamp]
   * characters   [hero]
   * ```
   */
  function nested(): AssetLibraryView {
    const category = (id: string, assets: string[], categories: unknown[] = []) => ({
      id,
      name: id,
      color: '#adadad',
      budgetMinor: null,
      // What a heading says is everything under it, which is what a drag has to
      // keep true as a tile crosses from one branch to another.
      count:
        assets.length +
        (categories as { count: number }[]).reduce((total, each) => total + each.count, 0),
      estimatedMinor: 0,
      categories,
      assets: assets.map(tile),
    });

    return {
      project: {
        id: 'p',
        name: 'Drowned Reach',
        slug: 'drowned-reach',
        currency: 'AUD',
        archived: false,
      },
      categories: [
        category('props', ['crate'], [category('interior', ['chair', 'lamp'])]),
        category('characters', ['hero']),
      ],
    } as unknown as AssetLibraryView;
  }

  const namesUnder = (view: AssetLibraryView, categoryId: string): string[] => {
    const walk = (
      categories: readonly AssetLibraryView['categories'][number][],
    ): AssetLibraryView['categories'] =>
      categories.flatMap((each) => [each, ...walk(each.categories)]);

    return (
      walk(view.categories)
        .find((each) => each.id === categoryId)
        ?.assets.map((asset) => asset.id) ?? []
    );
  };

  const countOf = (view: AssetLibraryView, categoryId: string): number => {
    const walk = (
      categories: readonly AssetLibraryView['categories'][number][],
    ): AssetLibraryView['categories'] =>
      categories.flatMap((each) => [each, ...walk(each.categories)]);

    return walk(view.categories).find((each) => each.id === categoryId)?.count ?? -1;
  };

  describe('WHEN a tile is dropped into a sub-category', () => {
    it('THEN it lands there rather than nowhere', () => {
      const dropped = resolveAssetDrop(nested(), 'crate', 'chair');

      expect(dropped?.move).toEqual({
        assetId: 'crate',
        toCategoryId: 'interior',
        beforeAssetId: 'chair',
        afterAssetId: null,
      });
      expect(namesUnder(dropped!.next, 'interior')).toEqual(['crate', 'chair', 'lamp']);
    });

    it('THEN the empty space of one takes it too', () => {
      const dropped = resolveAssetDrop(nested(), 'hero', 'interior');

      expect(dropped?.move.toCategoryId).toBe('interior');
      expect(namesUnder(dropped!.next, 'interior')).toEqual(['chair', 'lamp', 'hero']);
    });
  });

  describe('WHEN a tile is dragged out of a sub-category', () => {
    it('THEN it can be picked up at all, which is the half that was missing', () => {
      const dropped = resolveAssetDrop(nested(), 'lamp', 'hero');

      expect(dropped?.move.toCategoryId).toBe('characters');
      expect(namesUnder(dropped!.next, 'interior')).toEqual(['chair']);
      expect(namesUnder(dropped!.next, 'characters')).toEqual(['lamp', 'hero']);
    });
  });

  describe('WHEN a tile crosses from one branch to another', () => {
    it('THEN every heading above either end says what is under it', () => {
      // `interior` loses one and so does `props` above it; `characters` gains
      // one. A count that only moved at the ends would have the parent claiming
      // three while two tiles sit under it.
      const dropped = resolveAssetDrop(nested(), 'lamp', 'hero');

      expect(countOf(dropped!.next, 'interior')).toBe(1);
      expect(countOf(dropped!.next, 'props')).toBe(2);
      expect(countOf(dropped!.next, 'characters')).toBe(2);
    });

    it('THEN a move within one sub-category leaves every count alone', () => {
      const dropped = resolveAssetDrop(nested(), 'lamp', 'chair');

      expect(countOf(dropped!.next, 'interior')).toBe(2);
      expect(countOf(dropped!.next, 'props')).toBe(3);
    });
  });

  describe('WHEN a tile is let go over a heading', () => {
    it('THEN it is filed in that category, at the end', () => {
      // The only place a closed category offers, and the easiest one an open
      // empty category offers.
      const dropped = resolveAssetDrop(nested(), 'crate', headingIdOf('interior'));

      expect(dropped?.move).toEqual({
        assetId: 'crate',
        toCategoryId: 'interior',
        beforeAssetId: null,
        afterAssetId: 'lamp',
      });
      expect(namesUnder(dropped!.next, 'interior')).toEqual(['chair', 'lamp', 'crate']);
    });

    it('THEN its own heading puts it at the end of where it already is', () => {
      const dropped = resolveAssetDrop(nested(), 'chair', headingIdOf('interior'));

      expect(namesUnder(dropped!.next, 'interior')).toEqual(['lamp', 'chair']);
    });

    it('THEN the counts above both ends still move', () => {
      const dropped = resolveAssetDrop(nested(), 'hero', headingIdOf('interior'));

      expect(countOf(dropped!.next, 'interior')).toBe(3);
      expect(countOf(dropped!.next, 'props')).toBe(4);
      expect(countOf(dropped!.next, 'characters')).toBe(0);
    });
  });

  describe('WHEN where a tile ended up is read back', () => {
    it('THEN it is found in the sub-category it is actually in', () => {
      expect(describeAssetPlacement(nested(), 'lamp')).toEqual({
        assetId: 'lamp',
        toCategoryId: 'interior',
        beforeAssetId: null,
        afterAssetId: 'chair',
      });
    });
  });
});
