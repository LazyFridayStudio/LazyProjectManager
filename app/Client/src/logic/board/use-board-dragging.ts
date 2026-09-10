import {
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
  type DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { BoardList, BoardView, CardChip } from '@lpm/shared';
import { useState, type ComponentProps } from 'react';

import { useDisplay } from '../../components/ui/index.js';
import { applyCardMove, describePlacement, resolveDrop, type CardMove } from './card-drag.js';
import { collisionsOnBoard, isList, resolveListDrop } from './list-drag.js';
import { useBoardPreview, useMoveCard, type BoardPreview } from './use-cards.js';
import { useMoveList } from './use-lists.js';
import { describeOverLimit } from './wip-warning.js';

/** Everything the board's `DndContext` is told, and nothing it is not. */
type DragContextProps = Pick<
  ComponentProps<typeof DndContext>,
  | 'collisionDetection'
  | 'measuring'
  | 'onDragCancel'
  | 'onDragEnd'
  | 'onDragOver'
  | 'onDragStart'
  | 'sensors'
>;

/** What is being carried across the board, and how it is being carried. */
export interface BoardDragging {
  /** The card under the pointer, drawn as the drag overlay. */
  readonly card: CardChip | null;
  /** The column under the pointer, when it is a column being moved. */
  readonly list: BoardList | null;
  readonly context: DragContextProps;
}

/** What the board holds while something is being dragged across it. */
interface Carried {
  readonly card: CardChip | null;
  readonly list: BoardList | null;
  /**
   * The board as it was before the drag started.
   *
   * Kept because the board on screen is rewritten as the thing travels, so it is
   * no longer what to go back to if the server refuses the move.
   */
  readonly boardBefore: BoardView | null;
}

const NOTHING_CARRIED: Carried = { card: null, list: null, boardBefore: null };

/** The ways a finished drag has of saying what happened. */
interface DragTools {
  readonly preview: BoardPreview;
  readonly moveCard: ReturnType<typeof useMoveCard>;
  readonly moveList: ReturnType<typeof useMoveList>;
  readonly showWarning: (text: string) => void;
}

/** A drag that has just been let go of. */
interface Dropped {
  readonly event: DragEndEvent;
  /** The board as the drag left it, which is what the screen already shows. */
  readonly current: BoardView;
  /** The board before the drag, to put back if the server refuses the move. */
  readonly before: BoardView | null;
}

/**
 * Dragging a card between lists, and dragging a list along the board.
 *
 * Both live here rather than in the screen because both are the same three
 * decisions — what was picked up, where it is now, and what to put back if the
 * server says no — and a component holding those is a component that has
 * stopped being about what is drawn.
 */
export function useBoardDragging(view: BoardView): BoardDragging {
  const [carried, setCarried] = useState<Carried>(NOTHING_CARRIED);
  const tools = useDragTools(view.project.slug);

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so a click still opens a card.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return {
    card: carried.card,
    list: carried.list,
    context: {
      sensors,
      collisionDetection: collisionsOnBoard(view),
      // Droppables are re-measured continuously because a card changes list
      // mid-drag, which moves every list's bounds underneath it.
      measuring: { droppable: { strategy: MeasuringStrategy.Always } },

      onDragStart: (event: DragStartEvent) => {
        setCarried(pickedUp(view, event));
      },

      onDragOver: (event: DragOverEvent) => {
        stepCardAcross(tools, event);
      },

      onDragEnd: (event: DragEndEvent) => {
        finishDrag(tools, { event, before: carried.boardBefore });
        setCarried(NOTHING_CARRIED);
      },

      onDragCancel: () => {
        if (carried.boardBefore !== null) {
          tools.preview.write(carried.boardBefore);
        }

        setCarried(NOTHING_CARRIED);
      },
    },
  };
}

function useDragTools(projectSlug: string): DragTools {
  return {
    preview: useBoardPreview(projectSlug),
    moveCard: useMoveCard(projectSlug),
    moveList: useMoveList(projectSlug),
    showWarning: useDisplay().showWarning,
  };
}

/** What the drag picked up: a card off a list, or a whole list. */
function pickedUp(view: BoardView, event: DragStartEvent): Carried {
  const draggedId = String(event.active.id);

  return {
    card: findCard(view, draggedId),
    list: view.lists.find((list) => list.id === draggedId) ?? null,
    boardBefore: view,
  };
}

/**
 * Moves the card as the pointer travels rather than waiting for the drop.
 *
 * This is what makes the cards around it step aside, and what stops the drop
 * animating back to where the card came from — by the time the drag ends, the
 * card is already where the overlay is sitting.
 *
 * A column being dragged needs nothing here: the other columns step aside by
 * themselves, and where it lands is only decided when it is let go.
 */
function stepCardAcross(tools: DragTools, event: DragOverEvent): void {
  const over = event.over;
  const current = tools.preview.read();

  if (over === null || current === undefined || isList(current, String(event.active.id))) {
    return;
  }

  const step = resolveDrop(current, String(event.active.id), String(over.id));

  if (step !== null) {
    tools.preview.write(applyCardMove(current, step));
  }
}

function finishDrag(tools: DragTools, drop: Omit<Dropped, 'current'>): void {
  const current = tools.preview.read();

  if (current === undefined) {
    return;
  }

  if (isList(current, String(drop.event.active.id))) {
    dropList(tools, { ...drop, current });
    return;
  }

  dropCard(tools, { ...drop, current });
}

function dropCard(tools: DragTools, drop: Dropped): void {
  // Where the card actually ended up, which the drag has already written to the
  // board — not where the last drop event pointed.
  const move = describePlacement(drop.current, String(drop.event.active.id));

  if (move === null || isWhereItStarted(drop.before ?? drop.current, move)) {
    return;
  }

  tools.moveCard.mutate({ move, revertTo: drop.before ?? undefined });

  const overLimit = describeOverLimit(drop.current, move.toListId);

  if (overLimit !== null) {
    tools.showWarning(overLimit);
  }
}

/**
 * Puts a dropped column where it was let go, then asks the server for it.
 *
 * The board is rewritten first for the same reason a card's is: a drag is a
 * promise about where the thing will be, and the round trip that confirms it
 * takes long enough to watch the columns spring back.
 */
function dropList(tools: DragTools, drop: Dropped): void {
  const over = drop.event.over;

  if (over === null) {
    return;
  }

  const move = resolveListDrop(drop.current, String(drop.event.active.id), String(over.id));

  if (move === null) {
    return;
  }

  tools.preview.write(move.board);
  tools.moveList.mutate({
    listId: move.listId,
    beforeListId: move.beforeListId,
    afterListId: move.afterListId,
    revertTo: drop.before ?? drop.current,
  });
}

/** Whether the drag put the card back exactly where it was picked up. */
function isWhereItStarted(before: BoardView, move: CardMove): boolean {
  const placement = describePlacement(before, move.cardId);

  return (
    placement !== null &&
    placement.toListId === move.toListId &&
    placement.beforeCardId === move.beforeCardId &&
    placement.afterCardId === move.afterCardId
  );
}

function findCard(view: BoardView, cardId: string): CardChip | null {
  for (const list of view.lists) {
    const card = list.cards.find((candidate) => candidate.id === cardId);

    if (card !== undefined) {
      return card;
    }
  }

  return null;
}
