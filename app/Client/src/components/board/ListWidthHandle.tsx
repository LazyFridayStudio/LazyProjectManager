import { useRef } from 'react';

import {
  NARROWEST_LIST_WIDTH,
  WIDEST_LIST_WIDTH,
  keepListWidthUsable,
  listWidthAfterKey,
} from '../../logic/board/list-width.js';
import styles from './ListWidthHandle.module.css';

export interface ListWidthHandleProps {
  /** The width the columns are being drawn at now. */
  readonly width: number;
  /**
   * How many columns lie to the left of this edge, this one included.
   *
   * Every column changes together, so the edge somebody has hold of moves by
   * the change multiplied by the columns before it. Dividing the drag by that
   * many is what makes the edge stay under the pointer instead of running away
   * from it — noticeably, by the fifth column, at five times the speed.
   */
  readonly columnsBefore: number;
  /** Every pointer move, for showing the width being chosen. */
  readonly onResizing: (width: number) => void;
  /** The width to keep, once somebody has stopped choosing it. */
  readonly onSettled: (width: number) => void;
}

/**
 * The edge of a column, to drag the columns wider or narrower.
 *
 * One on every column rather than one on the board, because the edge is where
 * somebody reaches for it — and every one of them sets the same width, so the
 * board stays a row of the same kind of thing. Columns of different widths read
 * as if they meant something by it.
 *
 * A separator rather than a button: it is a splitter with a value, and saying so
 * is what lets a screen reader announce the width and a keyboard change it.
 * Pressing it twice, or `Home`, puts it back — dragging something to a size you
 * cannot undo is worse than not being able to drag it.
 */
export function ListWidthHandle({
  width,
  columnsBefore,
  onResizing,
  onSettled,
}: ListWidthHandleProps): React.JSX.Element {
  // Where the drag started and how wide the columns were then. A ref rather
  // than state: nothing on the screen depends on it, and re-rendering the board
  // on every pointer move is what this whole arrangement exists to avoid.
  const grabbedAt = useRef<{ readonly x: number; readonly width: number } | null>(null);

  const widthFrom = (clientX: number): number => {
    const grabbed = grabbedAt.current;

    if (grabbed === null) return width;

    return keepListWidthUsable(grabbed.width + (clientX - grabbed.x) / columnsBefore);
  };

  return (
    <div
      className={styles.handle}
      role="separator"
      aria-label="Column width"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={NARROWEST_LIST_WIDTH}
      aria-valuemax={WIDEST_LIST_WIDTH}
      tabIndex={0}
      onPointerDown={(event) => {
        // The primary button only. A right-press here is somebody asking their
        // browser for a menu, not asking for a narrower board.
        if (event.button !== 0) return;

        // Otherwise the drag selects the card titles it passes over.
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        grabbedAt.current = { x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        if (grabbedAt.current === null) return;

        onResizing(widthFrom(event.clientX));
      }}
      onPointerUp={(event) => {
        if (grabbedAt.current === null) return;

        onSettled(widthFrom(event.clientX));
        grabbedAt.current = null;
      }}
      // A capture lost to a cancelled gesture — a touch becoming a scroll, a
      // window losing focus mid-drag — never sends the release, and without
      // this the next pointer move would carry on resizing from an origin
      // nobody is holding any more.
      onLostPointerCapture={() => {
        grabbedAt.current = null;
      }}
      onDoubleClick={() => {
        onSettled(listWidthAfterKey(width, 'Home') ?? width);
      }}
      onKeyDown={(event) => {
        const next = listWidthAfterKey(width, event.key);

        if (next === null) return;

        // Or the arrows scroll the board sideways as well as resizing it, and
        // `Home` jumps it to the first column.
        event.preventDefault();
        onSettled(next);
      }}
    />
  );
}
