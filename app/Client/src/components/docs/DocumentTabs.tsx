import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DocumentTab } from '@lpm/shared';
import { useState } from 'react';

import { joinClassNames } from '../../lib/join-class-names.js';
import { neighboursAfterMove, neighboursAfterStep } from '../../logic/docs/document-order.js';
import { useCreateDesignDoc, useMoveDesignDoc } from '../../logic/docs/use-design-doc.js';
import styles from './DesignDocScreen.module.css';

export interface DocumentTabsProps {
  readonly projectId: string;
  readonly documents: readonly DocumentTab[];
  readonly openId: string | null;
  readonly canWrite: boolean;
  /** Which way the document below is set, so the tabs sit over it. */
  readonly isFullScreen: boolean;
  readonly onOpen: (docId: string) => void;
}

/**
 * The project's documents, across the top.
 *
 * Named and nothing else. They were numbered, on the reasoning that a studio
 * says "03" in a meeting more often than it says the whole title — which is
 * true of the chapters of one document and not of a row of separate ones.
 * Nobody calls the audio bible "02".
 *
 * The row sits over the document rather than over the window: centred while the
 * prose is centred, hard left the moment it runs the full width. A tab strip
 * that stayed put while the thing it names moved would read as a second column
 * of its own.
 *
 * The order is the studio's to set. It was the order the documents happened to
 * be made in, which is the order somebody typed rather than the order anybody
 * reads: a studio writes the brief, then the audio bible, then wants the
 * one-page pitch first. Drag a tab along the row, or press one along with
 * `Ctrl`+`Shift`+`←`/`→`.
 */
export function DocumentTabs({
  projectId,
  documents,
  openId,
  canWrite,
  isFullScreen,
  onOpen,
}: DocumentTabsProps): React.JSX.Element {
  const create = useCreateDesignDoc();
  const move = useMoveDesignDoc();
  const [dragging, setDragging] = useState<DocumentTab | null>(null);
  const ids = documents.map((document) => document.id);

  /*
   * The pointer only, and deliberately no keyboard sensor.
   *
   * A keyboard drag activates on `Space` or `Enter`, and on this row those two
   * keys already mean "open this document" — a tab that had to be picked up
   * before it could be opened would be a worse tab for everybody in order to be
   * a draggable one for somebody. The keyboard moves a document with
   * `Ctrl`+`Shift`+`←`/`→` instead, which is its own answer rather than a
   * gesture wearing a keyboard's clothes.
   */
  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so a press still opens the
    // document rather than picking it up.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  /*
   * Made and opened, rather than a prompt first.
   *
   * A blank box asking for a name is the wrong question at the wrong moment:
   * what a document is called is the last thing somebody knows about it, and
   * anybody who cancels that box has pressed a button that did nothing. It
   * arrives as `New doc` — a placeholder to type over, which is the bargain a
   * word processor makes — and `Rename` is there when they know.
   *
   * The name comes from the server, because two people adding one at the same
   * moment would otherwise both find `New doc` free.
   */
  const add = (): void => {
    create.mutate(
      { projectId },
      {
        onSuccess: (result) => {
          if (result.id !== undefined) onOpen(result.id);
        },
      },
    );
  };

  const send = (docId: string, neighbours: ReturnType<typeof neighboursAfterMove>): void => {
    if (neighbours === null) return;

    move.mutate({ docId, ...neighbours });
  };

  const row = (
    <div
      className={joinClassNames(styles.tabs, isFullScreen && styles.tabsFull)}
      role="tablist"
      aria-label="Documents"
    >
      <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
        {documents.map((document) => (
          <DocumentTabButton
            key={document.id}
            document={document}
            isOpen={document.id === openId}
            canMove={canWrite && documents.length > 1}
            onOpen={onOpen}
            onStep={(step) => {
              send(document.id, neighboursAfterStep(ids, document.id, step));
            }}
          />
        ))}
      </SortableContext>

      {canWrite && (
        /*
         * The one thing on this strip that is not a tab.
         *
         * Still text rather than a filled button — a button here would be the
         * loudest thing on a screen whose whole job is prose, and it sits in a
         * row of tabs that are all text. Green is what marks it out instead:
         * it makes a document, and green is what makes something.
         */
        <button type="button" className={styles.addTab} onClick={add}>
          + Document
        </button>
      )}
    </div>
  );

  if (!canWrite) return row;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event: DragStartEvent) => {
        setDragging(documents.find((document) => document.id === event.active.id) ?? null);
      }}
      onDragCancel={() => {
        setDragging(null);
      }}
      onDragEnd={(event: DragEndEvent) => {
        setDragging(null);

        const over = event.over;

        if (over === null) return;

        send(
          String(event.active.id),
          neighboursAfterMove(ids, String(event.active.id), ids.indexOf(String(over.id))),
        );
      }}
    >
      {row}

      {/* The tab under the pointer, so what is being carried is legible over
          whatever it is passing. No drop animation: it is already where the
          overlay is by the time it lands. */}
      <DragOverlay dropAnimation={null}>
        {dragging !== null && (
          <span className={joinClassNames(styles.tab, styles.tabLifted)}>
            <span className={styles.tabName}>{dragging.title}</span>
            <span className={styles.tabCount}>{String(dragging.wordCount)}</span>
          </span>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * One document in the row.
 *
 * A tab and a thing that can be dragged, which is a pair that has to be kept
 * honest: the pointer sensor waits for a few pixels of travel, so a press still
 * opens the document and only a drag moves it.
 *
 * `Ctrl`+`Shift`+`←`/`→` rather than the bare arrows. A `tablist` spends its
 * arrows moving focus between tabs, and taking them for reordering would both
 * break what somebody expects and spend the keys the right fix needs. `Alt` is
 * the other convention and is `Back` in a browser.
 */
function DocumentTabButton({
  document,
  isOpen,
  canMove,
  onOpen,
  onStep,
}: {
  readonly document: DocumentTab;
  readonly isOpen: boolean;
  readonly canMove: boolean;
  readonly onOpen: (docId: string) => void;
  readonly onStep: (step: -1 | 1) => void;
}): React.JSX.Element {
  const sortable = useSortable({ id: document.id, disabled: !canMove });

  return (
    <button
      ref={sortable.setNodeRef}
      type="button"
      // Spread before the role, not after: dnd-kit's attributes carry a
      // `role` of their own, and letting it land would turn every tab on this
      // strip into a button as far as anything reading the page is concerned.
      {...sortable.attributes}
      role="tab"
      className={joinClassNames(styles.tab, sortable.isDragging && styles.tabDragging)}
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
      }}
      aria-selected={isOpen}
      aria-keyshortcuts={canMove ? 'Control+Shift+ArrowLeft Control+Shift+ArrowRight' : undefined}
      title={canMove ? 'Ctrl+Shift+← or → to move it along the row' : undefined}
      {...sortable.listeners}
      onClick={() => {
        onOpen(document.id);
      }}
      onKeyDown={(event) => {
        if (!canMove || !event.ctrlKey || !event.shiftKey) return;
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

        // Or the row scrolls sideways under the tab being moved.
        event.preventDefault();
        onStep(event.key === 'ArrowLeft' ? -1 : 1);
      }}
    >
      <span className={styles.tabName}>{document.title}</span>
      <span className={styles.tabCount}>{String(document.wordCount)}</span>
    </button>
  );
}
