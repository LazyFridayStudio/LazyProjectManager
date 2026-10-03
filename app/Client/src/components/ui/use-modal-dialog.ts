import { useEffect, useRef, type RefObject } from 'react';

import { arrive, halt, leave } from './motion.js';

export interface ModalDialog {
  /** Spread onto the `dialog` element. */
  readonly dialogProps: {
    readonly ref: RefObject<HTMLDialogElement | null>;
    readonly onClose: () => void;
    readonly onCancel: (event: React.SyntheticEvent<HTMLDialogElement>) => void;
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
 * Escape, a press on the backdrop, and whatever the dialog itself decides is
 * done. All three go the same way out: the dialog moves out of sight first and
 * closes once it has, and `onClose` hears about it then.
 *
 * `panel` is for the card and the asset, which open over a whole screen and rise
 * into place; anything smaller grows where it stands.
 *
 * The backdrop is part of the `dialog` element rather than a separate node, so a
 * press on it arrives with the dialog as its target — anything inside reports
 * the thing that was actually pressed. That is the whole test, and it only holds
 * while the dialog has no padding of its own for a press to land in.
 */
export function useModalDialog(
  onClose: () => void,
  movement: 'dialog' | 'panel' = 'dialog',
): ModalDialog {
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
    const dialog = dialogRef.current;

    if (dialog === null) {
      return;
    }

    dialog.showModal();
    arrive(dialog, movement);

    // Taken away by whoever rendered it — a route change, a second panel opened
    // in its place — rather than closed, with nothing left to tween.
    return () => {
      halt(dialog);
    };
    // Opened once, on mount: the movement is fixed for the life of a dialog.
  }, []);

  const close = (): void => {
    const dialog = dialogRef.current;

    // Once: a second press of Close while the first is still on its way out is
    // the same request, not a second one.
    if (dialog === null || dialog.dataset.closing !== undefined) {
      return;
    }

    /*
     * Marked while it leaves, because it is still open until it has gone.
     *
     * Anything looking for the dialog somebody is working in — the display
     * putting a message where it can be seen — should look past one that is
     * on its way out, or the message leaves with it.
     */
    dialog.dataset.closing = '';
    leave(dialog, movement, () => {
      dialog.close();
    });
  };

  return {
    dialogProps: {
      ref: dialogRef,
      onClose,
      /*
       * Escape, held back so it leaves the way the other two do.
       *
       * The browser closes a dialog on Escape in the same frame, which would be
       * the one way out that snapped shut. It only lets a page hold one Escape
       * back per keypress somebody actually made, so a second one in a row
       * still closes it at once — and that is right: somebody pressing Escape
       * twice wants it gone, not animated.
       */
      onCancel: (event) => {
        event.preventDefault();
        close();
      },
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
