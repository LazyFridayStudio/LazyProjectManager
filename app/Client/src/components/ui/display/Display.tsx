import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { joinClassNames } from '../../../lib/join-class-names.js';
import { arrive, leave } from '../motion.js';

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
   *
   * Answering settles the promise straight away, so whatever was waiting on
   * the answer gets on with it; the question itself is only taken away once
   * its dialog has finished leaving.
   */
  const [asked, setAsked] = useState<Asked | null>(null);

  // A counter rather than `crypto.randomUUID`: this is a key for a list of at
  // most three things, and one that reads as 1, 2, 3 makes a failing test
  // legible.
  const nextId = useRef(0);
  const nextQuestion = useRef(0);

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
          nextQuestion.current += 1;
          setAsked({ id: nextQuestion.current, kind: 'confirm', request, settle });
        }),
      askForText: (request: TextRequest) =>
        new Promise<string | null>((settle) => {
          nextQuestion.current += 1;
          setAsked({ id: nextQuestion.current, kind: 'text', request, settle });
        }),
    }),
    [show],
  );

  return (
    <DisplayContext.Provider value={display}>
      {children}
      {asked !== null && (
        <Asking
          // A question asked while the last one is still leaving is a new
          // dialog, not the old one with different words in it.
          key={asked.id}
          asked={asked}
          onGone={() => {
            // Only if it is still the one on screen: a newer question has
            // replaced it, and is not this one's to take away.
            setAsked((current) => (current?.id === asked.id ? null : current));
          }}
        />
      )}
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
    // Not one that is on its way out, which is still open until it has gone and
    // would take the message with it.
    const open = document.querySelectorAll<HTMLDialogElement>('dialog[open]:not([data-closing])');

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
  const ref = useRef<HTMLDivElement>(null);

  // Faded out first and taken off the list once it has, however it goes: by
  // the dismiss button or by running out of time.
  const goAway = useCallback(() => {
    if (ref.current === null) {
      onDismiss(message.id);

      return;
    }

    leave(ref.current, 'fade', () => {
      onDismiss(message.id);
    });
  }, [message.id, onDismiss]);

  /*
   * A fade, and deliberately nothing that moves.
   *
   * A message that slides into place is a message whose edges are somewhere
   * else for the first frames after it appears, and somebody reaching for its
   * dismiss button — or a test doing the same — is aiming at a box that has
   * moved. The fade says "this is new" without that.
   */
  useLayoutEffect(() => {
    if (ref.current !== null) {
      arrive(ref.current, 'fade');
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(goAway, lifetimeOf(message.tone));

    return () => {
      window.clearTimeout(timer);
    };
  }, [message.tone, goAway]);

  return (
    <div ref={ref} className={styles.message} data-tone={message.tone} role={roleFor(message.tone)}>
      <div className={styles.body}>
        <span className={styles.label}>{labelFor(message.tone)}</span>
        <span className={styles.text}>{message.text}</span>
      </div>
      <button
        type="button"
        className={styles.dismiss}
        // The word, not a bare glyph: a lone ✕ is announced as "times".
        aria-label="Dismiss"
        onClick={goAway}
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
