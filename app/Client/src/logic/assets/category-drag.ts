import { closestCenter, type CollisionDetection, type UniqueIdentifier } from '@dnd-kit/core';
import type { SortingStrategy } from '@dnd-kit/sortable';
import type { AssetLibraryView } from '@lpm/shared';

import { categoryIdOfHeading, categoryIdOfRow, headingIdOf } from './heading-id.js';
import { findCategory, isInside, siblingsOf } from './category-tree.js';
import { overTheTiles } from './asset-drag.js';

export { categoryIdOfHeading, headingIdOf, rowIdOf } from './heading-id.js';

/**
 * Where in a heading's row a drop landed, and so what it means.
 *
 * `inside` puts the carried heading in that category; `before` and `after`
 * leave it alongside, which is how the order is rearranged.
 */
export type CategoryBand = 'before' | 'inside' | 'after';

/**
 * The headings do not step aside. The library is redrawn instead.
 *
 * A sorting strategy slides the rows around the one being carried, which is the
 * right answer for a list that does not move itself. This one does: a heading
 * dropped somewhere new is written into the library and the whole tree is drawn
 * again, which is what makes a category arrive with everything inside it.
 *
 * Both at once is the same move made twice. A section is as tall as everything
 * it holds, so the slide is measured in hundreds of pixels — the carried
 * heading was pushed off the top of the screen, and the heading below it was
 * slid up on top of the one being dragged.
 *
 * Kept as a strategy rather than deleted so the `SortableContext` still has
 * one, and so this says why there is nothing here.
 */
export const headingsStepAside: SortingStrategy = () => null;

/**
 * What a drag in the library can be dropped on, which depends on what is being
 * dragged.
 *
 * A tile may land on another tile or in the space of a category. A heading may
 * land only on another heading — without saying so, dragging one would collide
 * with whatever tile happens to be under the pointer, and a heading dropped
 * onto a tile means nothing.
 *
 * `closestCenter` rather than what is under the pointer: a heading being
 * carried down the page is over its own section for most of the journey,
 * because a section is as tall as everything open inside it. The nearest centre
 * is the heading somebody is aiming at.
 */
export const collisionsInLibrary: CollisionDetection = (args) => {
  if (categoryIdOfHeading(String(args.active.id)) === null) {
    return overTheTiles(args);
  }

  const carried = categoryIdOfHeading(String(args.active.id));

  /*
   * Every row but the carried heading's own.
   *
   * It cannot be dropped into itself, so its row is never an answer — and while
   * it is being carried it is the row most often under the pointer, because the
   * library redraws with it wherever the pointer went. Left in, a drag that
   * swept through the middle of a row on its way somewhere nested it there and
   * then sat over its own heading, where nothing resolves, so the accident
   * stuck.
   */
  const rows = args.droppableContainers.filter((container) => {
    const row = categoryIdOfRow(String(container.id));

    return row !== null && row !== carried;
  });

  const landed = rowUnderThePointer(rows, args.pointerCoordinates);

  if (landed !== undefined) {
    return [{ id: headingIdOf(landed.category), data: { band: bandOf(landed) } }];
  }

  /*
   * Between two rows, or a keyboard drag with no pointer at all. Whichever row
   * is nearest, and above or below it: there is no middle of a row to be in.
   */
  const nearest = closestCenter({ ...args, droppableContainers: rows })[0];

  if (nearest === undefined) return [];

  const category = categoryIdOfRow(String(nearest.id));
  const rect = args.droppableRects.get(nearest.id);

  if (category === null || rect === undefined) return [];

  /*
   * Above it or below it, whichever side of it the pointer is on. Never inside:
   * the middle of a row is a place, and the pointer is not on the row at all.
   */
  const band: CategoryBand =
    (args.pointerCoordinates?.y ?? rect.top) < rect.top + rect.height / 2 ? 'before' : 'after';

  return [{ id: headingIdOf(category), data: { band } }];
};

/** A heading's row, the pointer, and where in it the pointer is. */
interface LandedOn {
  readonly category: string;
  readonly rect: DOMRect;
  readonly pointer: { readonly x: number; readonly y: number };
}

/**
 * The row the pointer is actually inside, measured now rather than remembered.
 *
 * dnd-kit measures droppables when the set of them changes, and a drag through
 * a tree changes where they are without changing which they are — the preview
 * moves a heading, everything below it shifts, and every remembered rectangle
 * is a row out of date. Which was survivable while a drop only had to name a
 * row and became a bug the moment it had to name a *part* of one: the pointer
 * sat squarely on a heading and the arithmetic put it somewhere else entirely.
 *
 * One layout read per row per move, which is a real cost and the reason to say
 * so here. A library is tens of headings, the read is of a box the browser has
 * already laid out, and the alternative is an interaction that works a third of
 * the time.
 */
function rowUnderThePointer(
  rows: readonly { id: UniqueIdentifier; node: { current: HTMLElement | null } }[],
  pointer: { x: number; y: number } | null | undefined,
): LandedOn | undefined {
  if (pointer === null || pointer === undefined) return undefined;

  for (const row of rows) {
    const category = categoryIdOfRow(String(row.id));
    const rect = row.node.current?.getBoundingClientRect();

    if (category === null || rect === undefined) continue;

    /*
     * How far down, and nothing about how far across.
     *
     * A row is indented by how deep its category sits, so a heading three
     * levels in starts sixty pixels right of a top-level one. Asking the
     * pointer to be inside that meant a heading picked up by its grip — which
     * is where a hand goes — could never reach a row deeper than the one it
     * came from: the pointer stayed in its own column, matched nothing, and the
     * drop fell back to landing beside whatever was nearest.
     *
     * Only the height is the question. Which row somebody is on is what they
     * are pointing at; how far across they happen to be is where they picked
     * the thing up.
     */
    if (pointer.y >= rect.top && pointer.y <= rect.bottom) {
      return { category, rect, pointer };
    }
  }

  return undefined;
}

/**
 * Which part of a heading's row the pointer is in.
 *
 * The middle means inside — the way a folder takes what is dropped on it — and
 * the edges mean beside, which is how the order is rearranged. Two thirds of
 * the row are edge, because reordering is the commoner move and a rule that
 * made most of a row mean "inside" would make reordering a matter of aim.
 */
function bandOf({ rect, pointer }: LandedOn): CategoryBand {
  const howFarDown = (pointer.y - rect.top) / rect.height;

  if (howFarDown < 0.3) return 'before';

  return howFarDown > 0.7 ? 'after' : 'inside';
}

export interface CategoryMove {
  readonly categoryId: string;
  /**
   * What it should end up inside, and null for the top of the library.
   *
   * Always stated, even for a reorder that does not change it. The command reads
   * an absent parent as "leave it where it is", and a drag always knows the
   * answer — so saying it is one fewer thing that can be true by accident.
   */
  readonly parentId: string | null;
  /** The category it should end up above. */
  readonly beforeCategoryId: string | null;
  /** The category it should end up below. */
  readonly afterCategoryId: string | null;
}

/**
 * Where a heading would land, said the way the command takes it.
 *
 * Worked out at the moment it is needed rather than drawn as the pointer moves.
 * A library that reshapes itself under a drag moves the row being aimed at, and
 * a row that moves is a decision that changes — which is how a drop into a
 * sub-category came out right about one time in three, and why carrying a
 * heading looked as though the screen were fighting back. Nothing moves now
 * except the chip under the pointer and the mark saying where it will go.
 *
 * Null when the drop would change nothing, or would put a category inside its
 * own branch — a subtree that has left the library, which nothing could reach
 * and no walk over would end.
 */
export function describeDrop(
  view: AssetLibraryView,
  drop: { readonly moved: string; readonly onto: string; readonly band: CategoryBand },
): CategoryMove | null {
  const { moved, onto, band } = drop;

  if (moved === onto || isInside(view, onto, moved)) return null;

  return band === 'inside' ? intoIt(view, moved, onto) : besideIt(view, drop);
}

/** Inside the heading it was dropped on, after whatever is already in there. */
function intoIt(view: AssetLibraryView, moved: string, onto: string): CategoryMove | null {
  const parent = findCategory(view.categories, onto);

  if (parent === null) return null;

  const already = parent.categories.filter((category) => category.id !== moved);

  return {
    categoryId: moved,
    parentId: onto,
    beforeCategoryId: null,
    afterCategoryId: already[already.length - 1]?.id ?? null,
  };
}

/**
 * Above or below the heading it was dropped on, among the same categories.
 *
 * Read from the siblings *without* the carried one, because a heading dropped
 * just below where it already is would otherwise be told to go after itself.
 */
function besideIt(
  view: AssetLibraryView,
  { moved, onto, band }: { moved: string; onto: string; band: CategoryBand },
): CategoryMove | null {
  const siblings = siblingsOf(view, onto);

  if (siblings === null) return null;

  const among = siblings.categories.filter((category) => category.id !== moved);
  const sitsAt = among.findIndex((category) => category.id === onto);

  if (sitsAt === -1) return null;

  return band === 'before'
    ? {
        categoryId: moved,
        parentId: siblings.parentId,
        beforeCategoryId: onto,
        afterCategoryId: among[sitsAt - 1]?.id ?? null,
      }
    : {
        categoryId: moved,
        parentId: siblings.parentId,
        beforeCategoryId: among[sitsAt + 1]?.id ?? null,
        afterCategoryId: onto,
      };
}

/**
 * Where a category sits now, said as a move.
 *
 * Read back off the library rather than worked out again from the drop event,
 * for the reason `describeAssetPlacement` is: by the time a drag ends the
 * heading has already been put where it is going, and the last event names what
 * the pointer was over rather than the gap the headings opened for it.
 */
export function describeCategoryPlacement(
  view: AssetLibraryView,
  categoryId: string,
): CategoryMove | null {
  const siblings = siblingsOf(view, categoryId);

  if (siblings === null) return null;

  const sitsAt = siblings.categories.findIndex((category) => category.id === categoryId);

  if (sitsAt === -1) return null;

  return {
    categoryId,
    parentId: siblings.parentId,
    beforeCategoryId: siblings.categories[sitsAt + 1]?.id ?? null,
    afterCategoryId: siblings.categories[sitsAt - 1]?.id ?? null,
  };
}

/**
 * Whether the drag put the category back exactly where it was picked up.
 *
 * Picking a heading up and letting it go again is a drag, and asking the server
 * to move something to where it already is writes an audit entry for nothing.
 */
export function isWhereItStarted(before: AssetLibraryView, move: CategoryMove): boolean {
  const placement = describeCategoryPlacement(before, move.categoryId);

  return (
    placement !== null &&
    placement.parentId === move.parentId &&
    placement.beforeCategoryId === move.beforeCategoryId &&
    placement.afterCategoryId === move.afterCategoryId
  );
}
