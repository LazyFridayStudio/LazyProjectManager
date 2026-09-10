import { closestCorners, pointerWithin, type CollisionDetection } from '@dnd-kit/core';
import { rectSortingStrategy, type SortingStrategy } from '@dnd-kit/sortable';
import type { AssetLibraryView } from '@lpm/shared';

import { resolveDrop } from '../dragging/index.js';
import { findCategory, flattenCategories } from './category-tree.js';
import { categoryIdOfHeading } from './heading-id.js';

/** What a category's droppable says about itself, so a tile can be told apart. */
export const CATEGORY_DROPPABLE = { isCategory: true } as const;

/** What a tile's says about itself: that it is one, and which category it is in. */
export function tileDroppable(categoryId: string): { isTile: true; categoryId: string } {
  return { isTile: true, categoryId };
}

/**
 * What a drop has landed on: a tile if there is one, and otherwise which end of
 * the row the pointer is at.
 *
 * A category is a droppable and it *contains* its tiles, so the pointer being
 * inside one says almost nothing — it is inside the category for every drop,
 * including the ones squarely on a tile. Taking the category's answer meant the
 * gap before the first tile and the space past the last both read as "this
 * category", which the resolver rightly treats as the end. Dropping something
 * at the front put it at the back.
 *
 * So a tile under the pointer wins. Failing that — the gutter between two, the
 * margin at either end — the nearest tile of the category being hovered says
 * which end was meant. Only a category with no tiles at all answers for itself,
 * and for that one "the end" is the only place there is.
 *
 * A tile says it is one rather than being whatever is not a category. There is
 * a third kind of droppable now — the heading, which is what a category is
 * dragged by — and it wraps the tiles, so "not a category" would have made
 * every drop land on the section around them.
 *
 * And a category contains categories, so the pointer is inside several of them
 * at once — every one it is nested in, all the way to the top. The smallest is
 * the one being pointed at.
 */
export const overTheTiles: CollisionDetection = (args) => {
  const pointed = pointerWithin(args);
  const onATile = pointed.filter((collision) => isTile(args, collision.id));

  if (onATile.length > 0) return onATile;

  /*
   * A heading is a place to put something, and the only one a closed category
   * has.
   *
   * Everything under a category is drawn only while it is open, so a closed one
   * offers nothing to aim at — and an open empty one offers a strip of small
   * grey text. The heading is the part of a category that is always there and
   * always the same size, which makes it the answer to "how do I put this in
   * that one".
   */
  const heading = innermost(
    args,
    pointed.filter((collision) => isHeading(collision.id)),
  );

  if (heading !== undefined) return [heading];

  const category = innermost(
    args,
    pointed.filter((collision) => isCategory(args, collision.id)),
  );

  if (category === undefined) return closestCorners(args);

  const itsTiles = args.droppableContainers.filter(
    (container) =>
      container.data.current?.isTile === true && container.data.current.categoryId === category.id,
  );

  if (itsTiles.length === 0) return [category];

  return closestCorners({ ...args, droppableContainers: itsTiles });
};

/**
 * The most deeply nested of the things under the pointer.
 *
 * A sub-category sits inside its parent's box, so a pointer on `Interior` — its
 * heading, its tiles, its empty space — is inside `Props` around it as well, and
 * inside whatever holds that. Every one of them answers.
 *
 * The smallest box wins, which is the innermost one: nesting is what makes a box
 * smaller than the one it is in, so there is no ambiguity to break.
 *
 * Rather than the order `pointerWithin` returns, which is by distance from the
 * pointer to each box's centre. Two nested sections are both the width of the
 * screen, so their centres sit within a few pixels of each other and the nearer
 * one is decided by rounding — which is how a tile dropped squarely on a
 * sub-category's heading landed in its parent about half the time.
 */
function innermost(
  args: Parameters<CollisionDetection>[0],
  candidates: ReturnType<CollisionDetection>,
): (typeof candidates)[number] | undefined {
  return candidates.reduce<(typeof candidates)[number] | undefined>(
    (smallest, candidate) =>
      smallest === undefined || areaOf(args, candidate.id) < areaOf(args, smallest.id)
        ? candidate
        : smallest,
    undefined,
  );
}

/** How much of the screen a droppable covers, or all of it when it is unmeasured. */
function areaOf(args: Parameters<CollisionDetection>[0], id: string | number): number {
  const rect = args.droppableContainers.find((container) => container.id === id)?.rect.current;

  return rect === null || rect === undefined ? Number.POSITIVE_INFINITY : rect.width * rect.height;
}

function dataFor(
  args: Parameters<CollisionDetection>[0],
  id: string | number,
): Record<string, unknown> | undefined {
  return args.droppableContainers.find((container) => container.id === id)?.data.current;
}

function isHeading(id: string | number): boolean {
  return categoryIdOfHeading(String(id)) !== null;
}

function isCategory(args: Parameters<CollisionDetection>[0], id: string | number): boolean {
  return dataFor(args, id)?.isCategory === true;
}

function isTile(args: Parameters<CollisionDetection>[0], id: string | number): boolean {
  return dataFor(args, id)?.isTile === true;
}

/**
 * A category's tiles make room for one of their own, and stay still otherwise.
 *
 * Every category is its own `SortableContext`, so all of them are asked where
 * their tiles should go for every drag — including the three that have nothing
 * to do with it. `rectSortingStrategy` answers that question anyway, laying the
 * grid out around an item it cannot find, and the tiles slide across the row
 * for a drag happening somewhere else entirely.
 *
 * `activeIndex` is -1 when the thing being carried is not one of these tiles,
 * which is the whole of the question. The board asks it the same way, for the
 * same reason — see `columnsStepAside`.
 */
export const tilesStepAside: SortingStrategy = (args) =>
  args.activeIndex === -1 ? null : rectSortingStrategy(args);

/** What a finished drag asks the server for. */
export interface AssetMove {
  readonly assetId: string;
  readonly toCategoryId: string;
  readonly beforeAssetId: string | null;
  readonly afterAssetId: string | null;
}

export interface DroppedAsset {
  readonly move: AssetMove;
  /** The library as it should look straight away, before the server answers. */
  readonly next: AssetLibraryView;
}

/**
 * Where a dragged asset should end up, and what the screen should show while
 * the server is being told.
 *
 * Two cases, and only one of them is new. Dropping an asset among its own
 * category's is the same problem the board solves, so it is `resolveDrop` doing
 * it — the arithmetic for that lives there once, and this would be the second
 * place to get an off-by-one wrong. Carrying one into another category is the
 * case a single list never has: the asset is not already in the list it is
 * being placed into, so nothing has closed over the gap it left.
 *
 * `overId` is either an asset or a category. A category means the empty space
 * of one — dropped there, the asset goes on the end, which is what a drop into
 * open space looks like.
 */
export function resolveAssetDrop(
  view: AssetLibraryView,
  activeId: string,
  overId: string,
): DroppedAsset | null {
  const from = categoryHolding(view, activeId);

  if (from === null) return null;

  // A heading means the category it names, and the end of it: there is no tile
  // there to have been dropped onto.
  const headed = categoryIdOfHeading(overId);
  const droppedOnCategory = findCategory(view.categories, headed ?? overId);
  const to = droppedOnCategory ?? categoryHolding(view, overId);

  if (to === null) return null;

  const onOpenSpace = droppedOnCategory !== null;

  const drag: Drag = { view, from, to, activeId, overId: onOpenSpace ? null : overId };

  return to.id === from.id ? withinOneCategory(drag) : intoAnotherCategory(drag);
}

/**
 * The category one asset is filed in, wherever it sits in the tree.
 *
 * A library is nested now, so every one of these questions is a walk rather
 * than a look down a list — and a search that only read the top level was a
 * screen where an asset in a sub-category could be picked up and never put
 * down.
 */
function categoryHolding(
  view: AssetLibraryView,
  assetId: string,
): AssetLibraryView['categories'][number] | null {
  return (
    flattenCategories(view.categories).find((found) =>
      found.category.assets.some((asset) => asset.id === assetId),
    )?.category ?? null
  );
}

/** One drag, as both of the cases below need to see it. */
interface Drag {
  readonly view: AssetLibraryView;
  readonly from: AssetLibraryView['categories'][number];
  readonly to: AssetLibraryView['categories'][number];
  readonly activeId: string;
  /** The asset it was dropped on, or null for the open space of a category. */
  readonly overId: string | null;
}

/**
 * Dropped among its own category's assets.
 *
 * The board's arithmetic, unchanged — `resolveDrop` reads the neighbours from
 * the list *without* the asset, because the gap it left is what everything else
 * has already closed over. `overId` is null for a drop into open space, which
 * means the end, and which `resolveDrop` cannot express because there is no
 * asset there to be dropped onto.
 */
function withinOneCategory({ view, from: category, activeId, overId }: Drag): DroppedAsset | null {
  const target = overId ?? last(category, activeId);

  if (target === undefined) return null;

  const drop = resolveDrop(category.assets, activeId, target);

  if (drop === null) return null;

  return {
    move: {
      assetId: activeId,
      toCategoryId: category.id,
      beforeAssetId: drop.beforeId,
      afterAssetId: drop.afterId,
    },
    next: withCategory(view, category.id, inOrder(category.assets, drop.order)),
  };
}

/**
 * Carried into a category it was not in.
 *
 * The case a single list never has: nothing here has closed over a gap, because
 * the asset was never in this list — so its neighbours are read from the list
 * exactly as it stands.
 */
function intoAnotherCategory({ view, from, to, activeId, overId }: Drag): DroppedAsset | null {
  const landingAt =
    overId === null ? to.assets.length : to.assets.findIndex((asset) => asset.id === overId);
  const moved = from.assets.find((asset) => asset.id === activeId);

  if (moved === undefined || landingAt === -1) return null;

  return {
    move: {
      assetId: activeId,
      toCategoryId: to.id,
      beforeAssetId: to.assets[landingAt]?.id ?? null,
      afterAssetId: to.assets[landingAt - 1]?.id ?? null,
    },
    next: withCategory(
      withCategory(
        view,
        from.id,
        from.assets.filter((asset) => asset.id !== activeId),
      ),
      to.id,
      [...to.assets.slice(0, landingAt), moved, ...to.assets.slice(landingAt)],
    ),
  };
}

/**
 * Where an asset sits now, said as a move.
 *
 * Read back off the library rather than worked out again from the drop event,
 * because by the time a drag ends the asset has already been put where it is
 * going — the screen was rewritten as the pointer travelled. The two disagree
 * at exactly the moment it matters: the last event names what the pointer was
 * over, which is not the same as the gap the tiles opened for it.
 */
export function describeAssetPlacement(view: AssetLibraryView, assetId: string): AssetMove | null {
  const category = categoryHolding(view, assetId);

  if (category === null) return null;

  const sitsAt = category.assets.findIndex((asset) => asset.id === assetId);

  return {
    assetId,
    toCategoryId: category.id,
    beforeAssetId: category.assets[sitsAt + 1]?.id ?? null,
    afterAssetId: category.assets[sitsAt - 1]?.id ?? null,
  };
}

/**
 * Whether the drag put the asset back exactly where it was picked up.
 *
 * Picking a tile up and letting it go again is a drag, and asking the server to
 * move something to where it already is writes an audit entry for nothing.
 */
export function isWhereItStarted(before: AssetLibraryView, move: AssetMove): boolean {
  const placement = describeAssetPlacement(before, move.assetId);

  return (
    placement !== null &&
    placement.toCategoryId === move.toCategoryId &&
    placement.beforeAssetId === move.beforeAssetId &&
    placement.afterAssetId === move.afterAssetId
  );
}

/** The last asset of a category, ignoring the one being carried. */
function last(
  category: AssetLibraryView['categories'][number],
  activeId: string,
): string | undefined {
  const others = category.assets.filter((asset) => asset.id !== activeId);

  return others[others.length - 1]?.id;
}

function inOrder(
  assets: AssetLibraryView['categories'][number]['assets'],
  order: readonly string[],
): AssetLibraryView['categories'][number]['assets'] {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));

  return order.flatMap((id) => byId.get(id) ?? []);
}

/**
 * The library with one category's assets replaced.
 *
 * `count` follows, because it is what the heading says and a category that
 * gained an asset while still claiming the old number is the sort of small
 * wrongness somebody notices before the drag has even finished.
 */
function withCategory(
  view: AssetLibraryView,
  categoryId: string,
  assets: AssetLibraryView['categories'][number]['assets'],
): AssetLibraryView {
  return { ...view, categories: rewrite(view.categories, categoryId, assets).categories };
}

/**
 * One category's assets replaced, and the count of every heading above it moved
 * by the same amount.
 *
 * A count is everything under a heading, so a tile carried out of a
 * sub-category takes one off its parent and its parent's parent as well —
 * anything less and a drag leaves the numbers down the screen disagreeing with
 * the tiles under them until the server answers.
 *
 * The change is carried back up rather than counted again from the tiles,
 * because what a heading says is everything in it and what it holds is at most
 * two hundred of them.
 */
function rewrite(
  categories: readonly AssetLibraryView['categories'][number][],
  categoryId: string,
  assets: AssetLibraryView['categories'][number]['assets'],
): { categories: AssetLibraryView['categories']; moved: number } {
  let moved = 0;

  const rewritten = categories.map((category) => {
    if (category.id === categoryId) {
      const difference = assets.length - category.assets.length;

      moved += difference;

      return { ...category, assets, count: category.count + difference };
    }

    const below = rewrite(category.categories, categoryId, assets);

    moved += below.moved;

    return { ...category, categories: below.categories, count: category.count + below.moved };
  });

  return { categories: rewritten, moved };
}
