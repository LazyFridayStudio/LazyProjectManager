import {
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
  type DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { AssetCategory, AssetLibraryView, AssetTile } from '@lpm/shared';
import { useState, type ComponentProps } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import { useDisplay } from '../../components/ui/index.js';
import { describeAssetPlacement, isWhereItStarted, resolveAssetDrop } from './asset-drag.js';
import {
  categoryIdOfHeading,
  collisionsInLibrary,
  describeDrop,
  isWhereItStarted as categoryIsWhereItStarted,
  type CategoryBand,
} from './category-drag.js';
import { findCategory, flattenCategories } from './category-tree.js';
import { useAssetLibraryPreview, useMoveAsset, useMoveAssetCategory } from './use-assets.js';
import type { AssetFilters } from './asset-filters.js';

/** Everything the library's `DndContext` is told, and nothing it is not. */
type DragContextProps = Pick<
  ComponentProps<typeof DndContext>,
  | 'collisionDetection'
  | 'measuring'
  | 'onDragCancel'
  | 'onDragEnd'
  | 'onDragMove'
  | 'onDragOver'
  | 'onDragStart'
  | 'sensors'
>;

export interface AssetDragging {
  /** The asset under the pointer, drawn as the drag overlay. */
  readonly carried: AssetTile | null;
  /** The category under the pointer, when a heading is what is being carried. */
  readonly carriedCategory: AssetCategory | null;
  /**
   * Where the thing being carried would land, for the screen to mark.
   *
   * The only feedback a heading drag has, and deliberately so: the library is
   * not reshaped while the pointer is down, because a tree that reshapes moves
   * the row being aimed at. A tile still shows its place by the tiles stepping
   * aside, and this says which category it is stepping into.
   */
  readonly dropHint: DropHint | null;
  readonly context: DragContextProps;
}

/** A category, and where against it the thing would land. */
export interface DropHint {
  readonly categoryId: string;
  readonly band: CategoryBand;
}

/** What the library holds while something is being carried across it. */
interface Carried {
  readonly asset: AssetTile | null;
  readonly category: AssetCategory | null;
  /** Where it would land right now, redrawn as the pointer travels. */
  readonly hint: DropHint | null;
  /**
   * The library as it was before the drag started.
   *
   * Kept because the library on screen is rewritten as the thing travels, so it
   * is no longer what to go back to if the server refuses the move.
   */
  readonly libraryBefore: AssetLibraryView | null;
}

const NOTHING_CARRIED: Carried = {
  asset: null,
  category: null,
  hint: null,
  libraryBefore: null,
};

/** The ways a drag in flight has of saying what is happening. */
interface DragTools {
  readonly preview: ReturnType<typeof useAssetLibraryPreview>;
  readonly move: ReturnType<typeof useMoveAsset>;
  readonly moveCategory: ReturnType<typeof useMoveAssetCategory>;
  readonly showError: (text: string) => void;
}

/**
 * Carrying an asset across the library, or a heading up and down it.
 *
 * Two drags on one screen, and they are the same drag twice over: a tile is a
 * row inside a category, a heading is a row inside the library, and both are
 * drawn where they are going the moment the pointer passes rather than when the
 * server answers. A drag that waited for a round trip shows the thing springing
 * back to where it came from and then jumping forward again, which reads as the
 * drop having failed.
 *
 * Which is also why the library from *before* the drag is what a refusal puts
 * back. By the time the command is sent the screen already shows the new order,
 * and rolling back to that would leave it exactly where the server said it
 * could not go.
 */
export function useAssetDragging(
  slug: string,
  filters: AssetFilters,
  view: AssetLibraryView,
): AssetDragging {
  const [carried, setCarried] = useState<Carried>(NOTHING_CARRIED);
  const tools = useDragTools(slug, filters);

  /** Kept only when it changed, so a move that says the same thing is not a render. */
  const rememberWhereItIsGoing = (hint: DropHint | null): void => {
    setCarried((carrying) =>
      carrying.hint?.categoryId === hint?.categoryId && carrying.hint?.band === hint?.band
        ? carrying
        : { ...carrying, hint },
    );
  };

  const sensors = useSensors(
    // A few pixels before a drag begins, so pressing a tile still opens it.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return {
    carried: carried.asset,
    carriedCategory: carried.category,
    dropHint: carried.hint,
    context: {
      sensors,
      collisionDetection: collisionsInLibrary,
      // Droppables are re-measured continuously because a tile changes category
      // mid-drag, which moves every category's bounds underneath it.
      measuring: { droppable: { strategy: MeasuringStrategy.Always } },

      onDragStart: (event: DragStartEvent) => {
        const draggedId = String(event.active.id);
        const heading = categoryIdOfHeading(draggedId);

        setCarried({
          asset: heading === null ? assetIn(view, draggedId) : null,
          category: heading === null ? null : categoryIn(view, heading),
          // Where it starts, so the category it came from is marked from the
          // moment it leaves the ground rather than after the first move.
          hint: heading === null ? tileHint(whereItSits(view, draggedId)) : null,
          libraryBefore: tools.preview.read() ?? view,
        });
      },

      onDragOver: (event: DragOverEvent) => {
        rememberWhereItIsGoing(stepAcross(tools, event));
      },

      /*
       * Headings are followed on every move, not only when the row changes.
       *
       * Which row the pointer is over and which *part* of that row it is in are
       * two different questions, and only the first one makes dnd-kit call
       * `onDragOver`. Moving from the edge of a heading to its middle changes a
       * reorder into a nesting without changing the row — so a heading carried
       * straight down onto one never became a child of it, it just landed
       * beside it.
       *
       * Tiles are left to `onDragOver`, which is the whole of their question:
       * they land in what they are over.
       */
      onDragMove: (event: DragMoveEvent) => {
        if (categoryIdOfHeading(String(event.active.id)) === null) return;

        rememberWhereItIsGoing(stepAcross(tools, event));
      },

      onDragEnd: (event: DragEndEvent) => {
        finishDrag(tools, event, carried);
        setCarried(NOTHING_CARRIED);
      },

      onDragCancel: () => {
        if (carried.libraryBefore !== null) {
          tools.preview.write(carried.libraryBefore);
        }

        setCarried(NOTHING_CARRIED);
      },
    },
  };
}

function useDragTools(slug: string, filters: AssetFilters): DragTools {
  return {
    preview: useAssetLibraryPreview(slug, filters),
    move: useMoveAsset(slug, filters),
    moveCategory: useMoveAssetCategory(slug, filters),
    showError: useDisplay().showError,
  };
}

/**
 * Moves the thing as the pointer travels rather than waiting for the drop.
 *
 * This is what makes the tiles around it step aside, and what stops the release
 * being drawn in two parts. Waiting for the drop meant the overlay went at the
 * moment of letting go while the tile was still in the place it came from, and
 * the library only moved it a render later — a frame of the thumbnail back in
 * its old spot before it appeared in the new one.
 *
 * The board has done it this way since it was written, for the same reason.
 */
function stepAcross(tools: DragTools, event: DragOverEvent): DropHint | null {
  const over = event.over;
  const current = tools.preview.read();

  if (over === null || current === undefined) return null;

  const activeId = String(event.active.id);
  const overId = String(over.id);

  if (categoryIdOfHeading(activeId) !== null) {
    return carryAHeading(event);
  }

  const dropped = resolveAssetDrop(current, activeId, overId);

  if (dropped !== null) tools.preview.write(dropped.next);

  /*
   * Where the tile is now, rather than where this step said to put it.
   *
   * The two are the same until the drop changes nothing — hovering the category
   * a tile has already been carried into resolves to no move at all, and a
   * target read off the move would go out exactly when somebody is holding it
   * over the place they mean. Read off the library, it is answered for as long
   * as the tile is being carried.
   */
  return tileHint(whereItSits(dropped?.next ?? current, activeId));
}

/** A tile is only ever going *into* a category, so its hint says so. */
function tileHint(categoryId: string | null): DropHint | null {
  return categoryId === null ? null : { categoryId, band: 'inside' };
}

/**
 * One step of a heading being carried, and whether it would land inside
 * something.
 *
 * A heading moved between its neighbours lights nothing up — the headings
 * stepping aside already say where it is going. Dropped *into* a category it is
 * a different move with the same gesture, and the only sign of it is the one
 * this returns.
 */
function carryAHeading(event: DragOverEvent): DropHint | null {
  const onto = categoryIdOfHeading(String(event.over?.id ?? ''));

  return onto === null ? null : { categoryId: onto, band: bandFrom(event) };
}

/** What the collision said about where in a heading's row the pointer is. */
function bandFrom(event: DragOverEvent): CategoryBand {
  const said = event.collisions?.[0]?.data as { band?: CategoryBand } | undefined;

  return said?.band ?? 'after';
}

/** The category a carried tile is sitting in, as the library currently draws it. */
function whereItSits(view: AssetLibraryView, assetId: string): string | null {
  return describeAssetPlacement(view, assetId)?.toCategoryId ?? null;
}

/**
 * Asks the server for the move the drag has already drawn.
 *
 * Where the thing actually ended up, read off the library — not where the last
 * drop event pointed, which is a different question once the rows around it
 * have made room.
 */
function finishDrag(tools: DragTools, event: DragEndEvent, carried: Carried): void {
  const current = tools.preview.read();

  if (current === undefined) return;

  const activeId = String(event.active.id);
  const heading = categoryIdOfHeading(activeId);
  const before = carried.libraryBefore ?? current;

  if (heading !== null) {
    finishCategoryDrag({ tools, current, before, categoryId: heading, hint: carried.hint });
    return;
  }

  const move = describeAssetPlacement(current, activeId);

  if (move === null || isWhereItStarted(before, move)) return;

  tools.move.mutate(
    { move, libraryBefore: before },
    {
      onError: (error) => {
        tools.showError(describeFailure(error));
      },
    },
  );
}

/** One finished heading drag, as the half that sends it needs to see it. */
interface FinishedCategoryDrag {
  readonly tools: DragTools;
  /** The library as the drag has already drawn it. */
  readonly current: AssetLibraryView;
  /** The library as it was before the drag, which is what a refusal puts back. */
  readonly before: AssetLibraryView;
  readonly categoryId: string;
  /** What the screen was marking when it was let go. */
  readonly hint: DropHint | null;
}

function finishCategoryDrag({
  tools,
  current,
  before,
  categoryId,
  hint,
}: FinishedCategoryDrag): void {
  /*
   * Worked out now, from the mark the screen was showing.
   *
   * Nothing was redrawn while the pointer was down, so there is no rearranged
   * library to read the answer off — which is the point. What somebody saw is
   * what gets sent.
   */
  const move =
    hint === null
      ? null
      : describeDrop(current, { moved: categoryId, onto: hint.categoryId, band: hint.band });

  if (move === null || categoryIsWhereItStarted(before, move)) return;

  tools.moveCategory.mutate(
    { move, libraryBefore: before },
    {
      onError: (error) => {
        tools.showError(describeFailure(error));
      },
    },
  );
}

function assetIn(view: AssetLibraryView, assetId: string): AssetTile | null {
  return (
    flattenCategories(view.categories)
      .flatMap((found) => found.category.assets)
      .find((asset) => asset.id === assetId) ?? null
  );
}

function categoryIn(view: AssetLibraryView, categoryId: string): AssetCategory | null {
  return findCategory(view.categories, categoryId);
}
