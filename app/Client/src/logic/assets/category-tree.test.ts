import type { AssetCategory, AssetLibraryView } from '@lpm/shared';
import { describe, expect, it } from 'vitest';

import {
  descendantsOf,
  findCategory,
  flattenCategories,
  isInside,
  siblingsOf,
  withoutCategory,
  withSiblings,
} from './category-tree.js';

/**
 * The tree the whole library screen is read from.
 *
 * Pure arithmetic over the view, tested directly for the reason the drags are:
 * this is the half that can be wrong without anything throwing, and a wrong
 * answer here is a heading drawn in the wrong place or a branch that quietly
 * leaves the library.
 */
function category(id: string, categories: AssetCategory[] = []): AssetCategory {
  return {
    id,
    name: id,
    color: '#adadad',
    budgetMinor: null,
    count: 0,
    estimatedMinor: 0,
    categories,
    assets: [],
  };
}

/**
 * ```
 * props
 *   interior
 *     breakable
 *   exterior
 * characters
 * ```
 */
function library(): AssetLibraryView {
  return {
    project: {
      id: 'p',
      name: 'Drowned Reach',
      slug: 'drowned-reach',
      currency: 'AUD',
      archived: false,
    },
    categories: [
      category('props', [category('interior', [category('breakable')]), category('exterior')]),
      category('characters'),
    ],
    assetCount: 0,
    availableTags: [],
  };
}

describe('GIVEN a library several levels deep', () => {
  describe('WHEN it is flattened for the things that want a list', () => {
    it('THEN every category is there, parents before their children', () => {
      const flat = flattenCategories(library().categories);

      expect(flat.map((found) => found.category.id)).toEqual([
        'props',
        'interior',
        'breakable',
        'exterior',
        'characters',
      ]);
    });

    it('THEN each one knows how far in it sits, which is the indent', () => {
      const flat = flattenCategories(library().categories);

      expect(flat.map((found) => found.depth)).toEqual([0, 1, 2, 1, 0]);
    });
  });

  describe('WHEN one category is looked for', () => {
    it('THEN it is found however deep it is', () => {
      expect(findCategory(library().categories, 'breakable')?.id).toBe('breakable');
    });

    it('THEN one that is not there is null rather than a guess', () => {
      expect(findCategory(library().categories, 'gone')).toBeNull();
    });
  });

  describe('WHEN the categories beside one are asked for', () => {
    it('THEN a top-level category has the library, and no parent', () => {
      const siblings = siblingsOf(library(), 'characters');

      expect(siblings?.parentId).toBeNull();
      expect(siblings?.categories.map((each) => each.id)).toEqual(['props', 'characters']);
    });

    it('THEN one inside another has its parent and only its own siblings', () => {
      const siblings = siblingsOf(library(), 'interior');

      expect(siblings?.parentId).toBe('props');
      expect(siblings?.categories.map((each) => each.id)).toEqual(['interior', 'exterior']);
    });
  });

  describe('WHEN what is under a category is asked for', () => {
    it('THEN it is everything below it, and not the category itself', () => {
      const props = findCategory(library().categories, 'props');

      expect(descendantsOf(props!).map((each) => each.id)).toEqual([
        'interior',
        'breakable',
        'exterior',
      ]);
    });

    it('THEN a category deep inside another is inside it', () => {
      // The question a move has to ask before it draws anything: a category
      // carried into its own branch is a branch that leaves the library.
      expect(isInside(library(), 'breakable', 'props')).toBe(true);
    });

    it('THEN a category beside it is not', () => {
      expect(isInside(library(), 'characters', 'props')).toBe(false);
    });
  });

  describe('WHEN a branch is rewritten', () => {
    it('THEN only that branch changes', () => {
      const next = withSiblings(library(), 'props', [category('exterior')]);

      expect(next.categories[0]?.categories.map((each) => each.id)).toEqual(['exterior']);
      expect(next.categories[1]?.id).toBe('characters');
    });

    it('THEN rewriting the top replaces the library', () => {
      const next = withSiblings(library(), null, [category('characters')]);

      expect(next.categories.map((each) => each.id)).toEqual(['characters']);
    });
  });

  describe('WHEN a category is taken out of the tree', () => {
    it('THEN it is gone from wherever it was, and nothing else is', () => {
      const left = withoutCategory(library().categories, 'interior');

      expect(flattenCategories(left).map((found) => found.category.id)).toEqual([
        'props',
        'exterior',
        'characters',
      ]);
    });
  });
});
