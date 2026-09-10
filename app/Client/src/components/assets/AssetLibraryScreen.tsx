import { DndContext, DragOverlay, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  describeAssetStatus,
  type AssetCategory,
  type AssetLibraryView,
  type AssetTile,
} from '@lpm/shared';
import { useLocation } from '@tanstack/react-router';

import { ScreenHeader } from '../shell/ScreenHeader.js';
import { useEffect, useMemo, useState } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import { Button, ButtonIcon, ChevronIcon, PencilIcon, PlusIcon, TrashIcon } from '../ui/index.js';
import { formatMoney } from '../../logic/projects/format-project-values.js';
import { CardDetailDialog } from '../board/card-detail/CardDetailDialog.js';
import { AssetDetailDialog } from './AssetDetailDialog.js';
import { AssetFilterPanel } from './AssetFilterPanel.js';
import { AssetPicture } from './AssetPicture.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import {
  CATEGORY_DROPPABLE,
  tileDroppable,
  tilesStepAside,
} from '../../logic/assets/asset-drag.js';
import {
  headingIdOf,
  headingsStepAside,
  rowIdOf,
  type CategoryBand,
} from '../../logic/assets/category-drag.js';
import { flattenCategories, siblingsOf } from '../../logic/assets/category-tree.js';
import {
  useAssetDragging,
  type AssetDragging,
  type DropHint,
} from '../../logic/assets/use-asset-dragging.js';
import { EditCategoryDialog } from './EditCategoryDialog.js';
import { useDeleteCategory } from '../../logic/assets/use-delete-category.js';
import { NewAssetCategoryDialog } from './NewAssetCategoryDialog.js';
import { NewAssetDialog } from './NewAssetDialog.js';
import { LoadingProject } from '../shell/LoadingProject.js';
import { ProjectShell } from '../shell/ProjectShell.js';
import {
  countFilters,
  isFiltering,
  NO_FILTERS,
  type AssetFilters,
} from '../../logic/assets/asset-filters.js';
import { useAssetLibrary } from '../../logic/assets/use-assets.js';
import { useDebouncedValue } from '../../logic/assets/use-debounced-value.js';
import { useScrollToHashedCategory } from '../../logic/assets/use-scroll-to-hashed-category.js';
import styles from './AssetLibraryScreen.module.css';

/**
 * Everything a project has to make, grouped by what kind of thing it is.
 *
 * Separate from the board on purpose. A card is a piece of work somebody is
 * doing this week; an asset is a thing the game needs, which may take four cards
 * and three months, or none at all because it was cut.
 */
export function AssetLibraryScreen({ slug }: { slug: string }): React.JSX.Element {
  const [filters, setFilters] = useState<AssetFilters>(NO_FILTERS);

  // The typed search and the asked-for search are two different things: one
  // changes on every keystroke and the other is what the server is told.
  const settled = useDebouncedValue(filters.search);
  const library = useAssetLibrary(slug, { ...filters, search: settled });

  if (library.isPending) {
    return <LoadingProject slug={slug} active="assets" />;
  }

  if (library.isError) {
    return (
      <p className={styles.problem} role="alert">
        {describeFailure(library.error)}
      </p>
    );
  }

  return <Library view={library.data} slug={slug} filters={filters} onFilter={setFilters} />;
}

interface LibraryProps {
  readonly view: AssetLibraryView;
  readonly slug: string;
  readonly filters: AssetFilters;
  readonly onFilter: (filters: AssetFilters) => void;
}

function Library({ view, slug, filters, onFilter }: LibraryProps): React.JSX.Element {
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [addingTo, setAddingTo] = useState<{ id: string; name: string } | null>(null);
  const [editing, setEditing] = useState<AssetCategory | null>(null);
  const deleteCategory = useDeleteCategory(slug);
  const [opened, setOpened] = useState<string | null>(null);
  const [openedCard, setOpenedCard] = useState<string | null>(null);
  const [isFilterShown, setIsFilterShown] = useState(false);
  const canWrite = !view.project.archived;

  // Which category was named, and by what. Read from the router rather than
  // from `window`, because the tree is pressed while this screen is already
  // open: the hash changes without anything remounting to notice.
  const hash = useLocation({ select: (location) => location.hash });
  const dragging = useAssetDragging(slug, filters, view);

  const total = view.categories.reduce((sum, category) => sum + category.estimatedMinor, 0);
  const count = view.categories.reduce((sum, category) => sum + category.count, 0);
  const narrowed = isFiltering(filters);

  /*
   * The same array as long as the same categories are in it.
   *
   * dnd-kit turns transitions off for a frame whenever this list arrives as a
   * different array, and a drag re-renders on every pointer move — which is the
   * stepping aside that was smooth sometimes and instant the rest of the time
   * when the tiles inside a category had the same mistake.
   */
  const headingIds = useMemo(
    () => flattenCategories(view.categories).map((found) => headingIdOf(found.category.id)),
    [view.categories],
  );

  // Arrived at from the sidebar's tree. The browser cannot do this itself: the
  // heading being asked for does not exist until the library has loaded, which
  // is after the hash has already been and gone.
  useScrollToHashedCategory(flattenCategories(view.categories).length);

  return (
    <ProjectShell project={view.project} active="assets">
      <div className={styles.screen}>
        <LibraryHeader
          view={view}
          filters={filters}
          narrowed={narrowed}
          count={count}
          total={total}
          canWrite={canWrite}
          onFilter={onFilter}
          onToggleFilters={() => {
            setIsFilterShown((shown) => !shown);
          }}
          onNewCategory={() => {
            setIsAddingCategory(true);
          }}
        />

        {(isFilterShown || narrowed) && (
          <AssetFilterPanel
            filters={filters}
            availableTags={view.availableTags}
            onChange={onFilter}
            onHide={() => {
              setIsFilterShown(false);
              onFilter(NO_FILTERS);
            }}
          />
        )}

        {view.categories.length === 0 ? (
          <NothingToShow narrowed={narrowed} onFilter={onFilter} />
        ) : (
          <DndContext {...dragging.context}>
            {/* The headings are a list somebody arranges, the way the board's
                columns are — so the order the library reads in is the order the
                studio thinks in rather than the order things were made in. */}
            <SortableContext items={headingIds} strategy={headingsStepAside}>
              <div className={styles.categories}>
                {view.categories.map((category) => (
                  <Category
                    key={category.id}
                    category={category}
                    depth={0}
                    currency={view.project.currency}
                    canWrite={canWrite}
                    hash={hash}
                    narrowed={narrowed}
                    addingToId={addingTo?.id ?? null}
                    dropHint={dragging.dropHint}
                    onAdd={setAddingTo}
                    onEdit={setEditing}
                    onDelete={deleteCategory}
                    onOpen={setOpened}
                  />
                ))}
              </div>
            </SortableContext>

            <Carried dragging={dragging} currency={view.project.currency} />
          </DndContext>
        )}

        <Opened
          view={view}
          slug={slug}
          canWrite={canWrite}
          isAddingCategory={isAddingCategory}
          addingTo={addingTo}
          editing={editing}
          opened={opened}
          openedCard={openedCard}
          onCloseCategory={() => {
            setIsAddingCategory(false);
          }}
          onCloseAdding={() => {
            setAddingTo(null);
          }}
          onCloseEditing={() => {
            setEditing(null);
          }}
          onOpenAsset={setOpened}
          onOpenCard={setOpenedCard}
        />
      </div>
    </ProjectShell>
  );
}

/**
 * A library with nothing in it to draw, which is two different nothings.
 *
 * Filtered down to none is a dead end somebody needs a way out of; empty
 * because the project is new is a screen that has to say what a category is
 * for before anybody can make the first one.
 */
function NothingToShow({
  narrowed,
  onFilter,
}: {
  narrowed: boolean;
  onFilter: (filters: AssetFilters) => void;
}): React.JSX.Element {
  if (!narrowed) {
    return (
      <p className={styles.message}>
        Nothing here yet. A category is what kind of thing something is — environment props, world
        bosses, weapons — and a project starts with none because that differs by game.
      </p>
    );
  }

  return (
    <div className={styles.noMatches}>
      <span className={styles.noMatchesTitle}>No assets match these filters</span>
      <span className={styles.noMatchesHint}>
        Tags are combined with AND — an asset must carry every selected tag.
      </span>
      <Button
        onClick={() => {
          onFilter(NO_FILTERS);
        }}
      >
        Clear all filters
      </Button>
    </div>
  );
}

/**
 * What is under the pointer while something travels across the library.
 *
 * No drop animation, because the thing is already in the gap the others opened
 * for it — flying the overlay home and letting the real one appear afterwards
 * is the one thing that would look wrong. Which only holds while the two look
 * alike: a label carried and a tile dropped is a swap somebody sees, and reads
 * as the asset arriving instantly rather than being put down.
 */
function Carried({
  dragging,
  currency,
}: {
  readonly dragging: AssetDragging;
  readonly currency: string;
}): React.JSX.Element {
  return (
    <DragOverlay dropAnimation={null}>
      {dragging.carried !== null && (
        <div className={styles.tileCarried}>
          <TileFace asset={dragging.carried} currency={currency} />
        </div>
      )}

      {/* The heading alone, not the section under it: a category open at forty
          tiles would be carried as most of a screen, and what somebody is
          moving is the heading. */}
      {dragging.carriedCategory !== null && (
        <div
          className={styles.categoryCarried}
          style={{ '--category-color': dragging.carriedCategory.color } as React.CSSProperties}
        >
          <span className={styles.categoryName}>{dragging.carriedCategory.name}</span>
        </div>
      )}
    </DragOverlay>
  );
}

/**
 * The row a category is read as: its grip, its name, what is in it, its controls.
 *
 * Its own component so `Category` is about what a category contains rather than
 * about what its heading looks like — the two were one function of a hundred and
 * forty lines, and the recursion made it the part hardest to find your place in.
 */
function CategoryHead({
  category,
  currency,
  canWrite,
  isOpen,
  sortable,
  onToggle,
  onAdd,
  onEdit,
  onDelete,
}: {
  readonly category: AssetCategory;
  readonly currency: string;
  readonly canWrite: boolean;
  readonly isOpen: boolean;
  /** The heading's own drag, owned by the section so the whole thing moves. */
  readonly sortable: ReturnType<typeof useSortable>;
  readonly onToggle: () => void;
  readonly onAdd: (category: { id: string; name: string }) => void;
  readonly onEdit: (category: AssetCategory) => void;
  readonly onDelete: (category: AssetCategory) => void;
}): React.JSX.Element {
  /*
   * The row itself, as something a drop can be measured against.
   *
   * The heading is dragged by the section around it, which is as tall as
   * everything the category holds — so it says which group the pointer is in
   * and nothing about where in the heading it is. Dropping one category inside
   * another turns on that second question: the middle of a row means in, the
   * edges mean beside. Nothing is ever dropped on this; it exists to be
   * measured.
   */
  const row = useDroppable({ id: rowIdOf(category.id), disabled: !canWrite });

  return (
    <div ref={row.setNodeRef} className={styles.categoryHead}>
      {/* The grip and nothing else, unlike the board's column.

            A column's whole heading is a handle because there is nothing else
            on it; a category's heading is a button that opens the category, and
            a heading that both opened and dragged would be one somebody has to
            aim at to do either. */}
      {canWrite && (
        <button
          type="button"
          ref={sortable.setActivatorNodeRef}
          className={styles.categoryGrip}
          aria-label={`Reorder ${category.name}`}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <span className={styles.categoryGripDots}>⠿</span>
        </button>
      )}
      <button
        type="button"
        className={styles.categoryToggle}
        aria-expanded={isOpen}
        onClick={() => {
          onToggle();
        }}
      >
        <ChevronIcon isOpen={isOpen} className={styles.chevron} />
        <span className={styles.categoryName}>{category.name}</span>
        <span className={styles.categoryCount}>
          ({String(category.count)} {category.count === 1 ? 'item' : 'items'})
        </span>
      </button>

      <Spend category={category} currency={currency} />

      {canWrite && (
        <CategoryActions
          onAdd={() => {
            onAdd({ id: category.id, name: category.name });
          }}
          onEdit={() => {
            onEdit(category);
          }}
          onDelete={() => {
            onDelete(category);
          }}
        />
      )}
    </div>
  );
}

/**
 * The assets filed directly in a category, and where the first one is dropped.
 *
 * Its own component because a category now draws two different kinds of thing —
 * the categories inside it and the tiles beside them — and one function that
 * did both was one nobody could read the middle of.
 */
function CategoryTiles({
  category,
  currency,
  canWrite,
  tileIds,
  setNodeRef,
  onOpen,
}: {
  readonly category: AssetCategory;
  readonly currency: string;
  readonly canWrite: boolean;
  readonly tileIds: string[];
  /** The droppable the empty space and the grid share. */
  readonly setNodeRef: (element: HTMLElement | null) => void;
  readonly onOpen: (assetId: string) => void;
}): React.JSX.Element {
  return category.assets.length === 0 ? (
    // Still a place to drop into: a category with nothing in it is
    // exactly where somebody drags the first thing. Said differently when
    // the things in it are all one level down, because "nothing here" next
    // to five sub-categories reads as a bug.
    <p ref={setNodeRef} className={styles.categoryEmpty}>
      {category.categories.length === 0
        ? 'Nothing in this category yet.'
        : 'Nothing filed directly in this one.'}
    </p>
  ) : (
    <SortableContext
      items={tileIds}
      // A grid rather than a column, which is the only thing about this
      // that is not the board — and only for a tile of its own, or every
      // other category shuffles for a drag it is not part of.
      strategy={tilesStepAside}
    >
      <ul ref={setNodeRef} className={styles.tiles}>
        {category.assets.map((asset) => (
          <Tile
            key={asset.id}
            asset={asset}
            categoryId={category.id}
            currency={currency}
            canMove={canWrite}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </SortableContext>
  );
}

/**
 * Whether something asked for this category rather than it being one of many.
 *
 * Categories are closed to begin with, so something has to say which one a
 * person is actually here for. Four things can: the sidebar's tree puts the
 * category in the address, pressing Add on a heading names it, a search or a
 * tag filter asks for whatever is left — a narrowed library that draws only
 * headings has answered the question by hiding the answer — and something being
 * carried into it, because a closed category cannot show where the thing is
 * about to land.
 *
 * They are moments rather than states: a hash is navigated away from, the add
 * dialog closes, a drag ends. So this only ever opens a category, and what
 * asked for it is usually over by the time anybody looks.
 */
function wasAskedFor({
  category,
  hash,
  narrowed,
  addingToId,
  marked,
}: {
  readonly category: AssetCategory;
  readonly hash: string;
  readonly narrowed: boolean;
  readonly addingToId: string | null;
  readonly marked: CategoryBand | null;
}): boolean {
  return (
    narrowed ||
    hash === `category-${category.id}` ||
    addingToId === category.id ||
    marked === 'inside'
  );
}

interface CategoryProps {
  readonly category: AssetCategory;
  /**
   * How far down the tree this one sits, which is the indent and nothing else.
   *
   * Passed rather than measured, because a category renders its own children and
   * a component cannot see how it was reached.
   */
  readonly depth: number;
  readonly currency: string;
  readonly canWrite: boolean;
  /** The address's hash, which names the one category somebody arrived for. */
  readonly hash: string;
  /** Whether the library is filtered, in which case what is left is the answer. */
  readonly narrowed: boolean;
  /** The category whose Add dialog is open, if any. */
  readonly addingToId: string | null;
  /** Where the thing being carried would land, so that category can mark it. */
  readonly dropHint: DropHint | null;
  readonly onAdd: (category: { id: string; name: string }) => void;
  readonly onEdit: (category: AssetCategory) => void;
  readonly onDelete: (category: AssetCategory) => void;
  readonly onOpen: (assetId: string) => void;
}

function Category({
  category,
  depth,
  currency,
  canWrite,
  hash,
  narrowed,
  addingToId,
  dropHint,
  onAdd,
  onEdit,
  onDelete,
  onOpen,
}: CategoryProps): React.JSX.Element {
  /*
   * What the drag is saying about this category, if anything.
   *
   * One of three marks and never two: let go in the middle of a row it goes
   * inside, let go at either edge it goes above or below. Nothing else on the
   * screen moves while that is being decided.
   */
  const marked = dropHint?.categoryId === category.id ? dropHint.band : null;

  const isAskedFor = wasAskedFor({ category, hash, narrowed, addingToId, marked });

  /*
   * Everything a child is told that is the same for every category on the
   * screen.
   *
   * Gathered rather than restated at the recursion, because a category renders
   * categories and eight props copied by hand at every level is eight chances
   * for one of them to be dropped on the way down.
   */
  const inherited = {
    currency,
    canWrite,
    hash,
    narrowed,
    addingToId,
    dropHint,
    onAdd,
    onEdit,
    onDelete,
    onOpen,
  };
  /*
   * Closed to begin with, so the library opens as its own table of contents.
   *
   * A project with a dozen categories in it is several screens of tiles before
   * it is anything else, and the headings — what a category is called, what is
   * in it, what it costs — are the part somebody reads first. Open, they are
   * the part that scrolls past.
   *
   * Opened rather than toggled, and never closed here: a category that was
   * asked for is one somebody wants to see, but one they closed by hand
   * afterwards is one they are done with, and re-rendering is not a reason to
   * overrule that.
   */
  const [isOpen, setIsOpen] = useState(isAskedFor);

  useEffect(() => {
    if (isAskedFor) {
      setIsOpen(true);
    }
  }, [isAskedFor]);

  /*
   * The category itself takes a drop, not only the assets in it.
   *
   * Dropping into the space past the last tile, or into a category holding
   * nothing at all, has no asset under the pointer to land on — and those are
   * the two drops somebody makes when they want a thing at the end.
   */
  const { setNodeRef } = useDroppable({
    id: category.id,
    disabled: !canWrite,
    data: CATEGORY_DROPPABLE,
  });

  /*
   * The heading is a thing that can itself be picked up.
   *
   * Under an id of its own rather than the category's, because the category is
   * already the droppable above — one id cannot be two droppables, and "the
   * tiles of this category" and "this heading, among the headings" are two
   * places. `headingIdOf` is the only thing that knows how the two are told
   * apart.
   */
  const sortable = useSortable({
    id: headingIdOf(category.id),
    disabled: !canWrite,
    // The library is rewritten the moment the heading is dropped, so it is
    // already where it belongs; animating it there as well would be animating
    // it from a place it has already left. The same reason a tile does not.
    animateLayoutChanges: () => false,
  });

  /*
   * The same array as long as the same assets are in it.
   *
   * dnd-kit turns transitions off for a frame whenever this list arrives as a
   * different array — deliberately, so tiles do not slide about when the set
   * they belong to is replaced. Built fresh on every render it looked replaced
   * constantly, and since a drag re-renders on every pointer move, roughly
   * every other frame of a drag was drawn without a transition. That is the
   * stepping aside that was smooth sometimes and instant the rest of the time.
   */
  const tileIds = useMemo(() => category.assets.map((asset) => asset.id), [category.assets]);

  return (
    <section
      // What the sidebar's link points at. The tree is a table of contents, and
      // this is the heading it names.
      id={`category-${category.id}`}
      ref={sortable.setNodeRef}
      className={joinClassNames(
        styles.category,
        depth > 0 && styles.categoryNested,
        // Only while it is open: a closed heading has nothing under it, so a
        // line heading downwards from one points at the category below.
        isOpen && styles.categoryOpen,
        marked === 'inside' && styles.categoryTargeted,
        marked === 'before' && styles.dropAbove,
        marked === 'after' && styles.dropBelow,
        sortable.isDragging && styles.categoryDragging,
      )}
      style={
        {
          '--category-color': category.color,
          /*
           * The one being carried is left where it is.
           *
           * `verticalListSortingStrategy` offers the dragged item a transform
           * that would slide it to wherever it is going — which is right for a
           * list that moves itself, and wrong here twice over. The library is
           * already redrawn with the heading in its new place, so the transform
           * moves it a second time; and the thing following the pointer is the
           * overlay, not this. A section is as tall as everything it holds, so
           * the two together carried a whole category off the top of the
           * screen.
           */
          transform: sortable.isDragging ? undefined : CSS.Translate.toString(sortable.transform),
          transition: sortable.isDragging ? undefined : sortable.transition,
        } as React.CSSProperties
      }
    >
      <CategoryHead
        category={category}
        currency={currency}
        canWrite={canWrite}
        isOpen={isOpen}
        sortable={sortable}
        onToggle={() => {
          setIsOpen((open) => !open);
        }}
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
      />

      {/* Everything the category holds, in one element.

          So there is something for the line down its left to be the height of.
          That line is what says a grid of tiles four levels in belongs to this
          heading and not to the one above it — an indent alone leaves somebody
          measuring two edges against each other down a long screen.

          Categories before tiles: a heading is read as a group of headings
          first and a shelf of things second, and putting the tiles above them
          would bury the finer table of contents under a screen of pictures. */}
      {isOpen && (
        <div className={styles.categoryContents}>
          {category.categories.map((child) => (
            <Category key={child.id} {...inherited} category={child} depth={depth + 1} />
          ))}

          <CategoryTiles
            category={category}
            currency={currency}
            canWrite={canWrite}
            tileIds={tileIds}
            setNodeRef={setNodeRef}
            onOpen={onOpen}
          />
        </div>
      )}
    </section>
  );
}

/**
 * What a category is estimated to cost, against what it was budgeted.
 *
 * Over budget is shown rather than refused: the estimate is what it is, and
 * somebody has to see it to do anything about it.
 */
function Spend({
  category,
  currency,
}: {
  category: AssetCategory;
  currency: string;
}): React.JSX.Element {
  if (category.budgetMinor === null) {
    return <span className={styles.spend}>{formatMoney(category.estimatedMinor, currency)}</span>;
  }

  const share = Math.min(100, Math.round((category.estimatedMinor / category.budgetMinor) * 100));
  const overBudget = category.estimatedMinor > category.budgetMinor;

  return (
    <span className={styles.spend}>
      <span>
        {formatMoney(category.estimatedMinor, currency)} /{' '}
        {formatMoney(category.budgetMinor, currency)}
      </span>
      <span className={styles.bar}>
        <span
          className={styles.barFill}
          style={{ width: `${String(share)}%` }}
          data-over={overBudget}
        />
      </span>
      <span className={styles.share} data-over={overBudget}>
        {String(share)}%
      </span>
    </span>
  );
}

interface OpenedProps {
  readonly view: AssetLibraryView;
  readonly slug: string;
  readonly canWrite: boolean;
  readonly isAddingCategory: boolean;
  readonly addingTo: { id: string; name: string } | null;
  readonly editing: AssetCategory | null;
  readonly opened: string | null;
  readonly openedCard: string | null;
  readonly onCloseCategory: () => void;
  readonly onCloseAdding: () => void;
  readonly onCloseEditing: () => void;
  readonly onOpenAsset: (assetId: string | null) => void;
  readonly onOpenCard: (cardId: string | null) => void;
}

/**
 * Whatever is open over the library.
 *
 * Gathered here rather than left at the bottom of the screen component, because
 * six of them is most of what that function was and none of it is the library.
 */
function Opened({
  view,
  slug,
  canWrite,
  isAddingCategory,
  addingTo,
  editing,
  opened,
  openedCard,
  onCloseCategory,
  onCloseAdding,
  onCloseEditing,
  onOpenAsset,
  onOpenCard,
}: OpenedProps): React.JSX.Element {
  return (
    <>
      {isAddingCategory && (
        <NewAssetCategoryDialog
          projectId={view.project.id}
          projectSlug={slug}
          currency={view.project.currency}
          categories={view.categories}
          onDone={() => {
            onCloseCategory();
          }}
        />
      )}

      {opened !== null && (
        <AssetDetailDialog
          assetId={opened}
          projectSlug={slug}
          onClose={() => {
            onOpenAsset(null);
          }}
        />
      )}

      {openedCard !== null && (
        <CardDetailDialog
          cardId={openedCard}
          projectSlug={slug}
          canWrite={canWrite}
          onClose={() => {
            onOpenCard(null);
          }}
          onOpenCard={onOpenCard}
          onOpenAsset={(assetId) => {
            onOpenCard(null);
            onOpenAsset(assetId);
          }}
        />
      )}

      {editing !== null && (
        <EditCategoryDialog
          category={editing}
          projectSlug={slug}
          currency={view.project.currency}
          categories={view.categories}
          parentId={siblingsOf(view, editing.id)?.parentId ?? null}
          onDone={() => {
            onCloseEditing();
          }}
        />
      )}

      {addingTo !== null && (
        <NewAssetDialog
          projectId={view.project.id}
          projectSlug={slug}
          currency={view.project.currency}
          category={addingTo}
          onDone={() => {
            onCloseAdding();
          }}
        />
      )}
    </>
  );
}

interface LibraryHeaderProps {
  readonly view: AssetLibraryView;
  readonly filters: AssetFilters;
  readonly narrowed: boolean;
  /** How many the filter left, which is what the summary counts. */
  readonly count: number;
  readonly total: number;
  readonly canWrite: boolean;
  readonly onFilter: (filters: AssetFilters) => void;
  readonly onToggleFilters: () => void;
  readonly onNewCategory: () => void;
}

/**
 * What the library is, and how to narrow it.
 *
 * The name and what is under it stacked tight, with the controls centred
 * against the pair — the layout the task board's header uses, so the two
 * screens are recognisably the same product.
 */
function LibraryHeader({
  view,
  filters,
  narrowed,
  count,
  total,
  canWrite,
  onFilter,
  onToggleFilters,
  onNewCategory,
}: LibraryHeaderProps): React.JSX.Element {
  return (
    <ScreenHeader
      // What the screen is, the way Tasks says Tasks. It said the project's
      // name, which the sidebar beside it is already saying.
      title="Assets"
      facts={
        <>
          <span>
            {/* "12 of 39" while narrowed, rather than telling somebody their
                library shrank. */}
            {narrowed
              ? `${String(count)} of ${String(view.assetCount)} assets`
              : `${String(count)} ${count === 1 ? 'asset' : 'assets'}`}
          </span>
          {/* Every heading in the library, not only the ones at the top of it.
              A sidebar listing five while the header says two is two answers to
              one question. */}
          <span>{String(flattenCategories(view.categories).length)} categories</span>
          <span>{formatMoney(total, view.project.currency)} estimated</span>
        </>
      }
      actions={
        <>
          <input
            className={styles.search}
            type="search"
            aria-label="Search assets"
            placeholder={`Search ${String(view.assetCount)} assets…`}
            value={filters.search}
            onChange={(event) => {
              onFilter({ ...filters, search: event.target.value });
            }}
          />

          <Button onClick={onToggleFilters}>
            {narrowed ? `Filters · ${String(countFilters(filters))}` : 'Filters'}
          </Button>

          {canWrite && (
            <Button
              tone="go"
              onClick={() => {
                onNewCategory();
              }}
            >
              New category
            </Button>
          )}
        </>
      }
    />
  );
}

/**
 * How many of an asset's stages are done, on its tile.
 *
 * Nothing at all for an asset nobody has broken up: a tile reading 0/0 would be
 * a column of noise across a library where most things are one job.
 */
function Stages({ done, total }: { done: number; total: number }): React.JSX.Element | null {
  if (total === 0) {
    return null;
  }

  return (
    <span className={styles.assetStages} data-complete={done === total}>
      {done}/{total}
    </span>
  );
}

interface CategoryActionsProps {
  readonly onAdd: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}

/**
 * What can be done to a category, marked rather than spelled out.
 *
 * A library is a list of headings, and the same three words under every one of
 * them is chrome repeating down the screen instead of the thing somebody came
 * to read. The words are still here as each button's name, which is what a
 * screen reader says and what a hover shows — the same trade the document
 * header makes for the same reason.
 *
 * The tones do not move with the words. Green makes something, red takes
 * something away, and the pencil is neither; `a-button-that-removes-is-red`
 * reads those names rather than the markup, so the rule still reaches these
 * three now that there is nothing written on them.
 */
function CategoryActions({ onAdd, onEdit, onDelete }: CategoryActionsProps): React.JSX.Element {
  return (
    <span className={styles.categoryActions}>
      <Button tone="go" aria-label="Add" title="Add" onClick={onAdd}>
        <ButtonIcon>
          <PlusIcon size={14} />
        </ButtonIcon>
      </Button>
      <Button aria-label="Edit" title="Edit" onClick={onEdit}>
        <ButtonIcon>
          <PencilIcon size={14} />
        </ButtonIcon>
      </Button>
      <Button tone="stop" aria-label="Delete" title="Delete" onClick={onDelete}>
        <ButtonIcon>
          <TrashIcon size={14} />
        </ButtonIcon>
      </Button>
    </span>
  );
}

interface TileProps {
  readonly asset: AssetTile;
  /** Which row it is in, which a drop into the gutter needs to know. */
  readonly categoryId: string;
  readonly currency: string;
  readonly canMove: boolean;
  readonly onOpen: (assetId: string) => void;
}

/**
 * One asset in the library: a button that opens it, and a handle that drags it.
 *
 * The whole tile is both, the way a card on the board is. `PointerSensor` only
 * starts a drag after the pointer has travelled a few pixels, which is what
 * lets a click through — otherwise every attempt to open an asset would begin a
 * drag nobody asked for.
 */
function Tile({ asset, categoryId, currency, canMove, onOpen }: TileProps): React.JSX.Element {
  /*
   * No layout animation on the way down.
   *
   * The library is rewritten the moment the asset is dropped, so the tile is
   * already where it belongs; animating it there as well is animating it from a
   * place it has already left, which reads as the tile sliding across the row.
   * The same reason the overlay is dropped without an animation.
   */
  const sortable = useSortable({
    id: asset.id,
    disabled: !canMove,
    animateLayoutChanges: () => false,
    // That it is a tile, and which row it is in — so a drop into the gutter at
    // either end can be answered by the nearest tile of the right category
    // rather than by the category or the heading around it. See `overTheTiles`.
    data: tileDroppable(categoryId),
  });

  return (
    <li className={joinClassNames(styles.tile, sortable.isDragging && styles.tileDragging)}>
      {/*
        The tile is the thing you press and the thing you drag, the way a card
        on the board is.

        The sortable goes on the button rather than on the row around it,
        because dnd-kit's attributes carry `role="button"` — a row wearing one
        is a second control with the same name as the one inside it, and every
        way of finding an asset by name then matches two things.
      */}
      <button
        type="button"
        ref={sortable.setNodeRef}
        className={styles.tileOpen}
        style={{
          transform: CSS.Translate.toString(sortable.transform),
          transition: sortable.transition,
        }}
        {...sortable.attributes}
        {...sortable.listeners}
        onClick={() => {
          onOpen(asset.id);
        }}
      >
        <TileFace asset={asset} currency={currency} />
      </button>
    </li>
  );
}

/**
 * What an asset looks like, wherever it is being drawn.
 *
 * The tile draws it, and so does the thing carried under the pointer. They have
 * to be the same: the overlay vanishes the instant the drag ends and the real
 * tile is already in the gap it left, so anything that does not match is a
 * swap somebody sees. Carrying a small label and dropping a full tile is what
 * made the landing read as a jump rather than as an arrival.
 */
function TileFace({ asset, currency }: { asset: AssetTile; currency: string }): React.JSX.Element {
  return (
    <>
      {/* The first of its reference images, and what the thing is
                      if it has none. A library is read by looking at it. */}
      <AssetPicture
        url={asset.primaryReferenceUrl}
        alt=""
        fallback={describeAssetStatus(asset.status).toLowerCase()}
        imageClassName={styles.thumbnailImage}
        fallbackClassName={styles.thumbnail}
      />
      <span className={styles.assetName}>{asset.name}</span>
      <span className={styles.assetFoot}>
        <span className={styles.statusDot} data-status={asset.status} aria-hidden />
        <span className={styles.statusName}>{describeAssetStatus(asset.status)}</span>
        <span className={styles.assetCost}>
          {asset.estimatedCostMinor === null
            ? '—'
            : formatMoney(asset.estimatedCostMinor, currency)}
        </span>
      </span>
      {/* How much is known about it and how much work hangs off it.
                      An asset with no pictures and no cards is one somebody
                      wrote down and nobody has started. */}
      <span className={styles.assetCounts}>
        <span>{String(asset.referenceCount)} refs</span>
        <span className={styles.assetLinked} data-linked={asset.linkedCardCount > 0}>
          {asset.linkedCardCount === 0 ? 'unlinked' : `${String(asset.linkedCardCount)} linked`}
        </span>
        <Stages done={asset.subtasksDone} total={asset.subtaskCount} />
      </span>
      {/* What the studio files it under. On the tile because that
                      is where somebody scanning for "everything act-1" looks. */}
      {asset.tags.length > 0 && (
        <span className={styles.assetTags}>
          {asset.tags.map((tag) => (
            <span key={tag} className={styles.assetTag}>
              {tag}
            </span>
          ))}
        </span>
      )}
    </>
  );
}
