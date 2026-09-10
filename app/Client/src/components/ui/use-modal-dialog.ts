import { useEffect, useRef, type RefObject } from 'react';

export interface ModalDialog {
  /** Spread onto the `dialog` element. */
  readonly dialogProps: {
    readonly ref: RefObject<HTMLDialogElement | null>;
    readonly onClose: () => void;
    readonly onPointerDown: (event: React.PointerEvent<HTMLDialogElement>) => void;
    readonly onClick: (event: React.MouseEvent<HTMLDialogElement>) => void;
  };
  /** Closes it from a button, or once something has been saved. */
  close: () => void;
}

/**
 * Whether a press and its release both landed on the backdrop.
 *
 * A click's target is the nearest ancestor of *both* ends of it, so pressing
 * inside the dialog and letting go over the backdrop arrives as a click on the
 * dialog element itself — indistinguishable, to a handler reading the click
 * alone, from a press on the backdrop. That is one drag past the edge of a text
 * field away from throwing a half-typed form off the screen.
 *
 * The press is what says where somebody meant to click. Asking about both ends
 * keeps the backdrop click and refuses everything that merely finished there.
 */
export function isAPressOnTheBackdrop(
  dialog: HTMLDialogElement | null,
  pressedOn: EventTarget | null,
  releasedOn: EventTarget | null,
): boolean {
  return dialog !== null && pressedOn === dialog && releasedOn === dialog;
}

/**
 * A modal that opens on mount and closes the three ways people expect.
 *
 * Escape is the browser's, on a native `dialog`. The other two are here: a press
 * on the backdrop, and whatever the dialog itself decides is done.
 *
 * The backdrop is part of the `dialog` element rather than a separate node, so a
 * press on it arrives with the dialog as its target — anything inside reports
 * the thing that was actually pressed. That is the whole test, and it only holds
 * while the dialog has no padding of its own for a press to land in.
 */
export function useModalDialog(onClose: () => void): ModalDialog {
  const dialogRef = useRef<HTMLDialogElement>(null);
  /*
   * Where the pointer went down, kept until the click that follows it.
   *
   * A ref rather than state: nothing on the screen changes between the press
   * and the release, and re-rendering the dialog under somebody's finger to
   * remember where it landed would be a render per press.
   */
  const pressedOn = useRef<EventTarget | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const close = (): void => {
    dialogRef.current?.close();
  };

  return {
    dialogProps: {
      ref: dialogRef,
      onClose,
      onPointerDown: (event) => {
        pressedOn.current = event.target;
      },
      onClick: (event) => {
        if (isAPressOnTheBackdrop(dialogRef.current, pressedOn.current, event.target)) {
          close();
        }

        /*
         * Forgotten either way, so a click arriving without a press of its own
         * — a keyboard activating a button, a script — cannot be answered with
         * where somebody last put their finger.
         */
        pressedOn.current = null;
      },
    },
    close,
  };
}
