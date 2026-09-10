import type { AssetCategory, AssetLibraryView } from '@lpm/shared';

/**
 * A library is a tree now, and every screen that reads it has the same four
 * questions: what is in it, where does this one sit, what is under it, and what
 * does it look like once something has moved.
 *
 * Pure functions over the view, in `logic` rather than in a component, for the
 * reason the rest of this folder is: a drag is arithmetic with a picture on top,
 * and the arithmetic is the half worth testing.
 */

/** A category, and how deep it sits, in the order the screen draws them. */
export interface CategoryAtDepth {
  readonly category: AssetCategory;
  readonly depth: number;
}

/**
 * Every category, parents before their children, in reading order.
 *
 * What a flat list of ids is wanted for — the sortable context, the scroll
 * target, the picker — without each of those walking the tree itself.
 */
export function flattenCategories(
  categories: readonly AssetCategory[],
  depth = 0,
): CategoryAtDepth[] {
  return categories.flatMap((category) => [
    { category, depth },
    ...flattenCategories(category.categories, depth + 1),
  ]);
}

/** The category with this id, wherever it is in the tree. */
export function findCategory(
  categories: readonly AssetCategory[],
  categoryId: string,
): AssetCategory | null {
  return (
    flattenCategories(categories).find((found) => found.category.id === categoryId)?.category ??
    null
  );
}

/**
 * The categories directly alongside this one, and the one they are all inside.
 *
 * A position is a position among siblings, so this is the list every reorder is
 * arithmetic over. `parentId` is null when they are the top of the library.
 */
export interface Siblings {
  readonly parentId: string | null;
  readonly categories: readonly AssetCategory[];
}

export function siblingsOf(view: AssetLibraryView, categoryId: string): Siblings | null {
  if (view.categories.some((category) => category.id === categoryId)) {
    return { parentId: null, categories: view.categories };
  }

  for (const { category } of flattenCategories(view.categories)) {
    if (category.categories.some((child) => child.id === categoryId)) {
      return { parentId: category.id, categories: category.categories };
    }
  }

  return null;
}

/** Everything under a category, however deep, not counting the category itself. */
export function descendantsOf(category: AssetCategory): AssetCategory[] {
  return flattenCategories(category.categories).map((found) => found.category);
}

/**
 * Whether one category is inside another, at any depth.
 *
 * The question a move has to ask before it draws anything: a category dropped
 * inside its own descendant is a branch that leaves the library — nothing can
 * reach it and no walk over it ends. The server refuses it too; this stops the
 * screen drawing it in the meantime.
 */
export function isInside(view: AssetLibraryView, categoryId: string, possibleAncestorId: string) {
  const ancestor = findCategory(view.categories, possibleAncestorId);

  return ancestor !== null && descendantsOf(ancestor).some((each) => each.id === categoryId);
}

/**
 * The same library with one category's siblings rewritten.
 *
 * Rebuilt rather than mutated, because the view is what React compares to decide
 * what to draw again — and a tree edited in place is one where a branch changes
 * and nothing re-renders.
 */
export function withSiblings(
  view: AssetLibraryView,
  parentId: string | null,
  categories: readonly AssetCategory[],
): AssetLibraryView {
  if (parentId === null) {
    return { ...view, categories: [...categories] };
  }

  return { ...view, categories: [...replaceChildren(view.categories, parentId, categories)] };
}

function replaceChildren(
  categories: readonly AssetCategory[],
  parentId: string,
  children: readonly AssetCategory[],
): readonly AssetCategory[] {
  return categories.map((category) =>
    category.id === parentId
      ? { ...category, categories: children }
      : { ...category, categories: replaceChildren(category.categories, parentId, children) },
  );
}

/**
 * The same library with one category taken out of wherever it is.
 *
 * Half of a move between parents: the other half puts it back somewhere. Doing
 * it in two steps is what keeps the arithmetic the same as a reorder — remove,
 * then insert into a list, which is what `resolveDrop` already understands.
 */
export function withoutCategory(
  categories: readonly AssetCategory[],
  categoryId: string,
): AssetCategory[] {
  return categories
    .filter((category) => category.id !== categoryId)
    .map((category) => ({
      ...category,
      categories: withoutCategory(category.categories, categoryId),
    }));
}
