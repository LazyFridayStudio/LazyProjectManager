import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { joinClassNames } from '../../../lib/join-class-names.js';

import { Asking, type Asked, type ConfirmRequest, type TextRequest } from './Asking.js';
import {
  addMessage,
  dismissMessage,
  lifetimeOf,
  type DisplayMessage,
  type DisplayTone,
} from './display-messages.js';
import styles from './Display.module.css';

/**
 * The one place the product says something to the person using it.
 *
 * Before this, every screen grew its own paragraph under whatever control had
 * just failed. That reads fine on a form, where the message belongs beside the
 * field it is about — and badly everywhere else, because the thing that went
 * wrong is often not where the eye is. A file dropped on a reference sheet and
 * left out was a line of grey text under a strip of thumbnails somebody had
 * already looked away from.
 *
 * Field-level problems stay on their fields. This is for everything else.
 */
export interface Display {
  /** Something went wrong, and the person needs to know. */
  readonly showError: (text: string) => void;
  /** It worked, and it may not have been what they meant. */
  readonly showWarning: (text: string) => void;
  /** Something happened that is worth knowing and is not a fault. */
  readonly showInfo: (text: string) => void;
  /**
   * Asks before something is destroyed. True only if they said yes.
   *
   * Here rather than a dialog each screen wires up for itself, for the reason
   * the messages are here: the same question asked six ways is six chances for
   * one of them to be forgotten, and the ones that get forgotten are the
   * deletions people lose work to.
   */
  readonly askToConfirm: (request: ConfirmRequest) => Promise<boolean>;
  /** Asks for a line of text. Null if they closed it or left it empty. */
  readonly askForText: (request: TextRequest) => Promise<string | null>;
}

const DisplayContext = createContext<Display | null>(null);

export function DisplayProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [shown, setShown] = useState<readonly DisplayMessage[]>([]);
  /**
   * The question on screen, and the promise waiting on its answer.
   *
   * One at a time, because a question is asked in answer to something somebody
   * just pressed and they cannot press two things at once.
   */
  const [asked, setAsked] = useState<Asked | null>(null);

  // A counter rather than `crypto.randomUUID`: this is a key for a list of at
  // most three things, and one that reads as 1, 2, 3 makes a failing test
  // legible.
  const nextId = useRef(0);

  const show = useCallback((tone: DisplayTone, text: string) => {
    nextId.current += 1;
    const message = { id: String(nextId.current), tone, text };

    setShown((messages) => addMessage(messages, message));
  }, []);

  const dismiss = useCallback((id: string) => {
    setShown((messages) => dismissMessage(messages, id));
  }, []);

  // Stable, so a caller can hold it in a dependency list without re-running
  // whatever it guards on every render.
  const display = useMemo<Display>(
    () => ({
      showError: (text: string) => {
        show('error', text);
      },
      showWarning: (text: string) => {
        show('warning', text);
      },
      showInfo: (text: string) => {
        show('info', text);
      },
      askToConfirm: (request: ConfirmRequest) =>
        new Promise<boolean>((settle) => {
          setAsked({
            kind: 'confirm',
            request,
            settle: (said) => {
              setAsked(null);
              settle(said);
            },
          });
        }),
      askForText: (request: TextRequest) =>
        new Promise<string | null>((settle) => {
          setAsked({
            kind: 'text',
            request,
            settle: (said) => {
              setAsked(null);
              settle(said);
            },
          });
        }),
    }),
    [show],
  );

  return (
    <DisplayContext.Provider value={display}>
      {children}
      {asked !== null && <Asking asked={asked} />}
      <DisplayHost shown={shown} onDismiss={dismiss} />
    </DisplayContext.Provider>
  );
}

export function useDisplay(): Display {
  const display = useContext(DisplayContext);

  if (display === null) {
    throw new Error('useDisplay needs a DisplayProvider above it.');
  }

  return display;
}

/**
 * Where the messages have to be drawn to be seen at all.
 *
 * Most of what this product has to say happens while a modal `<dialog>` is open
 * — an upload from the asset panel, a card moved from its own panel. A modal
 * dialog is in the browser's top layer, and everything outside it is painted
 * under it and made inert, whatever its `z-index`.
 *
 * A popover is not the way out of that: one shown while a modal dialog is open
 * goes into the top layer *beneath* the dialog, so the message was both hidden
 * and unclickable. What works is to put the messages inside the dialog, which
 * is what this finds.
 *
 * Read when the list changes rather than watched, because a message only ever
 * appears in answer to something somebody just did — so the dialog they did it
 * in is the one open at that moment.
 */
function useMessageContainer(count: number): HTMLElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (count === 0) {
      setContainer(null);

      return;
    }

    // The last one, because dialogs in this product open over each other: a
    // card panel opens over the asset panel that linked to it.
    const open = document.querySelectorAll<HTMLDialogElement>('dialog[open]');

    setContainer(open[open.length - 1] ?? document.body);
  }, [count]);

  return container;
}

interface DisplayHostProps {
  readonly shown: readonly DisplayMessage[];
  readonly onDismiss: (id: string) => void;
}

function DisplayHost({ shown, onDismiss }: DisplayHostProps): React.JSX.Element | null {
  const container = useMessageContainer(shown.length);

  if (container === null) {
    return null;
  }

  return createPortal(
    <div
      className={joinClassNames(
        styles.host,
        // Inside a dialog the messages go to the top, off its buttons.
        container.tagName === 'DIALOG' && styles.hostInDialog,
      )}
    >
      {shown.map((message) => (
        <Shown key={message.id} message={message} onDismiss={onDismiss} />
      ))}
    </div>,
    container,
  );
}

/**
 * One message, which takes itself away.
 *
 * The role is on the message rather than on the list around it. A live region
 * containing another live region announces twice in some screen readers, and
 * this way an error interrupts — `alert` is assertive — while a notice waits
 * its turn, which is the difference between the two.
 */
function Shown({
  message,
  onDismiss,
}: {
  message: DisplayMessage;
  onDismiss: (id: string) => void;
}): React.JSX.Element {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onDismiss(message.id);
    }, lifetimeOf(message.tone));

    return () => {
      window.clearTimeout(timer);
    };
  }, [message.id, message.tone, onDismiss]);

  return (
    <div className={styles.message} data-tone={message.tone} role={roleFor(message.tone)}>
      <div className={styles.body}>
        <span className={styles.label}>{labelFor(message.tone)}</span>
        <span className={styles.text}>{message.text}</span>
      </div>
      <button
        type="button"
        className={styles.dismiss}
        // The word, not a bare glyph: a lone ✕ is announced as "times".
        aria-label="Dismiss"
        onClick={() => {
          onDismiss(message.id);
        }}
      >
        ✕
      </button>
    </div>
  );
}

function roleFor(tone: DisplayTone): 'alert' | 'status' {
  // A warning interrupts as well: it is about something that has already
  // happened, and hearing about it after the next three things is too late.
  return tone === 'info' ? 'status' : 'alert';
}

/**
 * The tone in a word.
 *
 * Read out with the message, and the half of the severity that survives being
 * looked at by somebody who cannot separate the red from the orange.
 */
function labelFor(tone: DisplayTone): string {
  return LABEL_BY_TONE[tone];
}

const LABEL_BY_TONE: Readonly<Record<DisplayTone, string>> = {
  error: 'Problem',
  warning: 'Careful',
  info: 'Note',
};
