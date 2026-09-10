import { DndContext, DragOverlay } from '@dnd-kit/core';
import { ScreenHeader } from '../shell/ScreenHeader.js';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MAXIMUM_CARDS_PER_LIST, type BoardList, type BoardView } from '@lpm/shared';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import { Button } from '../ui/index.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import styles from './BoardScreen.module.css';
import { CardChipTile, DraggedCard } from './CardChipTile.js';
import { DraggedLegend, LegendChipTile } from './LegendChipTile.js';
import { RepositorySynced } from '../forge/RepositorySync.js';
import { SyncIssues } from './SyncIssues.js';
import { TaskTabs } from './TaskTabs.js';
import { AssetDetailDialog } from '../assets/AssetDetailDialog.js';
import { CardDetailDialog } from './card-detail/CardDetailDialog.js';
import { ProjectShell } from '../shell/ProjectShell.js';
import { ListDialog } from './ListDialog.js';
import { ListWidthHandle } from './ListWidthHandle.js';
import { NewCardDialog } from './NewCardDialog.js';
import { columnsStepAside } from '../../logic/board/list-drag.js';
import { useBoard } from '../../logic/board/use-board.js';
import { useBoardDragging } from '../../logic/board/use-board-dragging.js';
import { useListWidth } from '../../logic/board/use-list-width.js';
import {
  cardChipMatches,
  countFilters,
  countMatchingUnder,
  isFiltering,
  NO_FILTERS,
  type TaskFilters,
} from '../../logic/board/task-filters.js';
import { peopleOnTheBoard, someCardIsUnassigned } from '../../logic/board/board-people.js';
import { FiltersButton } from './FiltersButton.js';
import { TaskFilterPanel } from './TaskFilterPanel.js';

export function BoardScreen({ slug }: { slug: string }): React.JSX.Element {
  const board = useBoard(slug);

  if (board.isPending) {
    return <p className={styles.message}>Loading the board…</p>;
  }

  if (board.isError) {
    return (
      <p className={styles.problem} role="alert">
        {describeFailure(board.error)}
      </p>
    );
  }

  return <Board view={board.data} />;
}

/** What the board has open over itself, which only one thing can be at a time. */
interface BoardInteraction {
  /** The list a new card is being added to. */
  addingTo: BoardList | null;
  /** The card whose detail panel is open. */
  opened: string | null;
  /** An asset opened from a card, over the board rather than instead of it. */
  openedAsset: string | null;
  /**
   * The list dialog: a list to change, or `'new'` to add one.
   *
   * One field rather than two, because only one of them can be open.
   */
  listDialog: BoardList | 'new' | null;
}

const NOTHING_OPEN: BoardInteraction = {
  addingTo: null,
  opened: null,
  openedAsset: null,
  listDialog: null,
};

function Board({ view }: { view: BoardView }): React.JSX.Element {
  const [interaction, setInteraction] = useState<BoardInteraction>(NOTHING_OPEN);
  const dragging = useBoardDragging(view);
  const canWrite = !view.project.archived;
  const [listWidth, keepListWidth] = useListWidth();
  const screen = useRef<HTMLDivElement>(null);
  /*
   * What the board is narrowed to, and whether the panel is open.
   *
   * Two pieces of state rather than one, because a panel that shut itself when
   * the last chip came off would take the way back with it — and the filter
   * outlives the panel, which is why the button carries the count.
   *
   * Per visit rather than remembered: `use-list-width` is the pattern for a
   * preference kept on one machine and a width is safe to remember, but cards
   * missing from a board because of something switched on last Tuesday is the
   * kind of thing people report as data loss.
   */
  const [filters, setFilters] = useState<TaskFilters>(NO_FILTERS);
  const [isFilterShown, setIsFilterShown] = useState(false);

  const update = (change: Partial<BoardInteraction>): void => {
    setInteraction((current) => ({ ...current, ...change }));
  };

  useArrivingCard(view, setInteraction);

  /*
   * The width being dragged, written straight to the screen rather than held in
   * state.
   *
   * A board is hundreds of cards, and putting the width through React would
   * re-render every one of them on every pointer move. What lands in state is
   * the width somebody settled on, once.
   */
  const showListWidth = (width: number): void => {
    screen.current?.style.setProperty('--list-width', `${String(width)}px`);
  };

  return (
    <ProjectShell project={view.project} active="board">
      {/* On the screen rather than on the row of columns, because the column
          travelling under the pointer during a drag is drawn out here beside
          them and has to be the same width as the one it left. */}
      <div
        className={styles.screen}
        ref={screen}
        style={{ '--list-width': `${String(listWidth)}px` } as React.CSSProperties}
      >
        <BoardHeader
          view={view}
          filters={filters}
          isFilterShown={isFilterShown}
          onToggleFilters={() => {
            setIsFilterShown((shown) => !shown);
          }}
          onAdd={() => {
            update({ addingTo: view.lists[0] ?? null });
          }}
          onAddList={() => {
            update({ listDialog: 'new' });
          }}
        />

        {/* Shown while it is open, and also while the board is still narrowed
            with it shut — a board quietly hiding half its cards needs the way
            back in front of somebody, not one press away. */}
        {(isFilterShown || isFiltering(filters)) && (
          <TaskFilterPanel
            filters={filters}
            people={peopleOnTheBoard(view)}
            hasUnassigned={someCardIsUnassigned(view)}
            onChange={setFilters}
          />
        )}

        <DndContext {...dragging.context}>
          <div className={styles.lists}>
            {/* The columns are ordered by hand as well as the cards in them: a
                fifth working stage added to the end almost never belongs after
                Done. */}
            <SortableContext items={view.lists.map((list) => list.id)} strategy={columnsStepAside}>
              {view.lists.map((list, index) => (
                <BoardListColumn
                  key={list.id}
                  list={list}
                  canWrite={canWrite}
                  filters={filters}
                  width={{
                    now: listWidth,
                    columnsBefore: index + 1,
                    onResizing: showListWidth,
                    onSettled: keepListWidth,
                  }}
                  onOpenCard={(cardId) => {
                    update({ opened: cardId });
                  }}
                  onAddCard={() => {
                    update({ addingTo: list });
                  }}
                  onOpenSettings={() => {
                    update({ listDialog: list });
                  }}
                />
              ))}
            </SortableContext>

            {/* At the end of the row rather than in the header, because a list
                is added in relation to the ones already there — and because the
                dashed column is where the eye is when the thought occurs. */}
            {canWrite && (
              <button
                type="button"
                className={styles.addList}
                onClick={() => {
                  update({ listDialog: 'new' });
                }}
              >
                + Add another list
              </button>
            )}
          </div>

          {/* No drop animation: the card is already where the overlay is, so
            flying it back to where the drag began and letting the real card
            appear afterwards is the one thing that would look wrong. */}
          <DragOverlay dropAnimation={null}>
            {dragging.card !== null &&
              (dragging.card.isLegend ? (
                <DraggedLegend card={dragging.card} />
              ) : (
                <DraggedCard card={dragging.card} />
              ))}
            {dragging.list !== null && <DraggedList list={dragging.list} />}
          </DragOverlay>
        </DndContext>

        <BoardDialogs view={view} interaction={interaction} update={update} />
      </div>
    </ProjectShell>
  );
}

/**
 * Obeys `?card=`, then takes it out of the address.
 *
 * Somebody following a notification is often already on this board, so the
 * screen does not remount and there is no arrival to hook — the instruction
 * arriving again is the whole event, which is why the address is cleared as
 * soon as it is obeyed. Setting it a second time then reads as a second press
 * rather than as no change at all.
 *
 * Everything else already open is closed. Two panels stacked because of a link
 * followed from somewhere else is nobody's intent.
 */
function useArrivingCard(
  view: BoardView,
  setInteraction: React.Dispatch<React.SetStateAction<BoardInteraction>>,
): void {
  const { card } = useSearch({ from: '/p/$slug/tasks' });
  const navigate = useNavigate();
  const { slug } = view.project;

  useEffect(() => {
    if (card === undefined) {
      return;
    }

    setInteraction({ ...NOTHING_OPEN, opened: card });

    void navigate({ to: '/p/$slug/tasks', params: { slug }, search: {}, replace: true });
  }, [card, navigate, setInteraction, slug]);
}

/**
 * What screen this is, which view of it you are on, and what you can do to it.
 *
 * The screen is called Tasks rather than called after the project: the project
 * is named twice in the sidebar already, and a heading that repeats it says
 * nothing about where you are. What the eyebrow says instead is what is on the
 * screen — how many lists, how many open cards, and where they came from.
 *
 * The same arrangement the timeline has, because it is the same shape of
 * screen: a name on the left, a choice of view in the middle, and the actions
 * on the right.
 */
function BoardHeader({
  view,
  filters,
  isFilterShown,
  onToggleFilters,
  onAdd,
  onAddList,
}: {
  view: BoardView;
  filters: TaskFilters;
  isFilterShown: boolean;
  onToggleFilters: () => void;
  onAdd: () => void;
  onAddList: () => void;
}): React.JSX.Element {
  const chosen = countFilters(filters);
  const narrowed = isFiltering(filters);
  /*
   * The total says what it is counting.
   *
   * Unfiltered it is every open card, which is more than is drawn — a list
   * returns at most `MAXIMUM_CARDS_PER_LIST`. Narrowed, it can only be what
   * arrived and was then kept, so it counts the chips rather than claiming to
   * know about the ones the cap left behind.
   */
  const cardTotal = narrowed
    ? view.lists.reduce(
        (total, list) => total + list.cards.filter((card) => cardChipMatches(card, filters)).length,
        0,
      )
    : view.lists.reduce((total, list) => total + list.count, 0);

  return (
    <ScreenHeader
      title="Tasks"
      facts={
        <>
          <span>
            {cardTotal} {narrowed ? 'cards shown' : 'open cards'}
          </span>
          <span>
            {view.lists.length} {view.lists.length === 1 ? 'list' : 'lists'}
          </span>
          <RepositorySynced sync={view.issues} />
        </>
      }
      actions={
        /*
         * Three groups with a rule between them: which view, then what it is
         * narrowed to, then what to make. The separators are what say the tabs
         * and the New buttons are not the same kind of thing — a flat row of
         * six controls reads as six unrelated choices.
         */
        <>
          <TaskTabs slug={view.project.slug} active="board" />
          <HeaderRule />
          <FiltersButton isOpen={isFilterShown} chosen={chosen} onToggle={onToggleFilters} />
          <HeaderRule />
          {view.project.archived && <span className={styles.readOnly}>Archived</span>}
          {!view.project.archived && (
            <SyncIssues projectId={view.project.id} issues={view.issues} />
          )}
          {/* Before New card, and not because it matters more: a board with four
              lists pushes the dashed column at the end of the row off the side of
              the screen, and this is the way in that is always visible. */}
          {!view.project.archived && (
            <Button tone="go" onClick={onAddList}>
              New list
            </Button>
          )}
          {!view.project.archived && (
            <Button tone="go" onClick={onAdd}>
              New card
            </Button>
          )}
        </>
      }
    />
  );
}

/** The hairline between one group of header controls and the next. */
export function HeaderRule(): React.JSX.Element {
  return <span className={styles.headerRule} aria-hidden />;
}

/**
 * The chips in one column, and what to say when there are none.
 *
 * Its own component because the column around it had grown past what one
 * function should hold, and this is the part of it that answers a different
 * question: the column is a place things are dropped, and this is what is in it.
 */
function ListCards({
  cards,
  hiddenCount,
  filters,
  canWrite,
  onOpenCard,
}: {
  readonly cards: readonly BoardList['cards'][number][];
  readonly hiddenCount: number;
  readonly filters: TaskFilters;
  readonly canWrite: boolean;
  readonly onOpenCard: (cardId: string) => void;
}): React.JSX.Element {
  return (
    <>
      <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
        {cards.map((card) =>
          card.isLegend ? (
            <LegendChipTile
              key={card.id}
              card={card}
              onOpen={onOpenCard}
              canMove={canWrite}
              matching={isFiltering(filters) ? countMatchingUnder(card, filters) : undefined}
            />
          ) : (
            <CardChipTile key={card.id} card={card} onOpen={onOpenCard} canMove={canWrite} />
          ),
        )}
      </SortableContext>

      {/* Narrowed and empty is a different sentence from empty: the first is
          about the reader, and the second about the project. */}
      {cards.length === 0 && (
        <p className={styles.listEmpty}>
          {isFiltering(filters) ? 'Nothing here matches.' : 'Nothing here yet.'}
        </p>
      )}

      {hiddenCount > 0 && (
        <p className={styles.truncated}>
          {!isFiltering(filters) ? (
            <>
              {hiddenCount} more — a list shows the first {MAXIMUM_CARDS_PER_LIST}
            </>
          ) : (
            /* The cap comes first and the filter second, so those cards were
               never looked at. Saying "N more" under a narrowed column would
               imply they had been, and that yours are all here. */
            <>
              {hiddenCount} more were not looked at — a list shows the first{' '}
              {MAXIMUM_CARDS_PER_LIST}
            </>
          )}
        </p>
      )}
    </>
  );
}

interface BoardListColumnProps {
  readonly list: BoardList;
  readonly canWrite: boolean;
  /** Everything the edge of this column needs to set the width of all of them. */
  readonly width: {
    readonly now: number;
    readonly columnsBefore: number;
    readonly onResizing: (width: number) => void;
    readonly onSettled: (width: number) => void;
  };
  /** What the board is narrowed to, which every column applies for itself. */
  readonly filters: TaskFilters;
  readonly onOpenCard: (cardId: string) => void;
  readonly onAddCard: () => void;
  readonly onOpenSettings: () => void;
}

function BoardListColumn({
  list,
  canWrite,
  width,
  onOpenCard,
  onAddCard,
  onOpenSettings,
  filters,
}: BoardListColumnProps): React.JSX.Element {
  // The column is a drop target, so a card can be dropped into an empty list or
  // below the last card rather than only onto another card — and it is a thing
  // that can itself be dragged, by anywhere on its heading.
  const sortable = useSortable({ id: list.id, disabled: !canWrite });
  /*
   * The limit reads the real list, not the narrowed one. A column that is over
   * its limit is over it whoever is looking, and a filter that quietly cleared
   * the warning would be the filter deciding something it has no business
   * deciding.
   */
  const overLimit = list.wipLimit !== null && list.count > list.wipLimit;
  const cards = list.cards.filter((card) => cardChipMatches(card, filters));
  /*
   * What the cap left behind, which is counted before the filter rather than
   * after it: the board returns the first `MAXIMUM_CARDS_PER_LIST` and only
   * then is anything narrowed, so what survives is what survives out of what
   * arrived. Saying so is the difference between a short answer and a wrong one.
   */
  const hiddenCount = list.count - list.cards.length;

  return (
    <section
      ref={sortable.setNodeRef}
      className={joinClassNames(
        styles.list,
        sortable.isOver && styles.listOver,
        sortable.isDragging && styles.listDragging,
      )}
      style={
        {
          '--list-color': list.color,
          transform: CSS.Translate.toString(sortable.transform),
          transition: sortable.transition,
        } as React.CSSProperties
      }
      aria-label={list.name}
    >
      {/* The listeners are on the whole heading as well as on the grip, so a
          column can be picked up anywhere along the row somebody is already
          reading. The grip is what says so, and what a keyboard reaches. */}
      <div className={styles.listHeader} {...sortable.listeners}>
        {canWrite && (
          <button
            type="button"
            ref={sortable.setActivatorNodeRef}
            className={styles.listGrip}
            aria-label={`Reorder ${list.name}`}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            ⠿
          </button>
        )}
        <span className={styles.listDot} aria-hidden />
        <h2 className={styles.listName}>{list.name}</h2>
        {/* The count follows the filter, because a number over a column and a
            different number of chips under it is two answers to one question. */}
        <span className={styles.listCount}>{isFiltering(filters) ? cards.length : list.count}</span>
        {list.wipLimit !== null && (
          <span className={joinClassNames(styles.listWip, overLimit && styles.listWipExceeded)}>
            wip {list.wipLimit}
          </span>
        )}
        {canWrite && (
          <button
            type="button"
            className={styles.listSettings}
            aria-label={`${list.name} settings`}
            onClick={onOpenSettings}
          >
            ⋯
          </button>
        )}
      </div>

      {/* Everything below the name scrolls together, so a long list keeps its
          heading and the button that adds to it stays under the last card
          rather than pinned somewhere the cards are not. */}
      <div className={styles.listCards}>
        <ListCards
          cards={cards}
          hiddenCount={hiddenCount}
          filters={filters}
          canWrite={canWrite}
          onOpenCard={onOpenCard}
        />

        {canWrite && (
          <button type="button" className={styles.addCard} onClick={onAddCard}>
            + Add card
          </button>
        )}
      </div>

      {/* Outside the part that scrolls, so the edge is the whole height of the
          column and not only the height of the cards in it. Drawn whether or
          not the project can be written to: how wide somebody reads a board is
          not a change to the board. */}
      <ListWidthHandle
        width={width.now}
        columnsBefore={width.columnsBefore}
        onResizing={width.onResizing}
        onSettled={width.onSettled}
      />
    </section>
  );
}

/**
 * The column under the pointer while a list is being dragged.
 *
 * Its heading and nothing else. A whole column of cards travelling with the
 * pointer covers the board it is being dropped onto, and what somebody is
 * placing is the list rather than the work in it.
 */
function DraggedList({ list }: { list: BoardList }): React.JSX.Element {
  return (
    <div
      className={joinClassNames(styles.list, styles.listLifted)}
      style={{ '--list-color': list.color } as React.CSSProperties}
    >
      <div className={styles.listHeader}>
        <span className={styles.listDot} aria-hidden />
        <h2 className={styles.listName}>{list.name}</h2>
        <span className={styles.listCount}>{list.count}</span>
      </div>
    </div>
  );
}

/** Everything the board can open over itself. */
function BoardDialogs({
  view,
  interaction,
  update,
}: {
  view: BoardView;
  interaction: BoardInteraction;
  update: (change: Partial<BoardInteraction>) => void;
}): React.JSX.Element {
  const canWrite = !view.project.archived;

  return (
    <>
      {interaction.addingTo !== null && (
        <NewCardDialog
          projectId={view.project.id}
          projectSlug={view.project.slug}
          list={interaction.addingTo}
          onClose={() => {
            update({ addingTo: null });
          }}
        />
      )}

      {interaction.listDialog !== null && (
        <ListDialogFor
          view={view}
          target={interaction.listDialog}
          onClose={() => {
            update({ listDialog: null });
          }}
        />
      )}

      {interaction.openedAsset !== null && (
        <AssetDetailDialog
          assetId={interaction.openedAsset}
          projectSlug={view.project.slug}
          onClose={() => {
            update({ openedAsset: null });
          }}
        />
      )}

      {interaction.opened !== null && (
        <CardDetailDialog
          cardId={interaction.opened}
          projectSlug={view.project.slug}
          canWrite={canWrite}
          onClose={() => {
            update({ opened: null });
          }}
          onOpenAsset={(assetId) => {
            // Over the board, as `SCREENS.md` asks of every modal: opening an
            // asset from a card should not take somebody off the board they
            // were working on.
            update({ openedAsset: assetId });
          }}
          onOpenCard={(cardId) => {
            // The panel stays open and shows the other card. Closing this one to
            // open that one would flash the board in between, and a link
            // followed is a step sideways rather than a return to where you
            // started.
            update({ opened: cardId });
          }}
        />
      )}
    </>
  );
}

/** The list dialog, with the other lists its cards could be moved to. */
function ListDialogFor({
  view,
  target,
  onClose,
}: {
  view: BoardView;
  target: BoardList | 'new';
  onClose: () => void;
}): React.JSX.Element {
  const list = target === 'new' ? null : target;

  return (
    <ListDialog
      boardId={view.boardId}
      projectSlug={view.project.slug}
      list={list}
      otherLists={view.lists.filter((other) => other.id !== list?.id)}
      onClose={onClose}
    />
  );
}
