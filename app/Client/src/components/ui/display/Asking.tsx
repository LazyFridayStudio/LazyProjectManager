import { useState } from 'react';

import { Button } from '../Button.js';
import { Field } from '../Field.js';
import { useModalDialog } from '../use-modal-dialog.js';
import styles from './Asking.module.css';

/**
 * A question the product needs answered before it carries on.
 *
 * `consequence` is required rather than optional, because it is the whole
 * reason the dialog exists. A confirmation that only asks "are you sure"
 * teaches people to press the second button without reading either of them,
 * and then it is furniture in the way of what they meant to do.
 */
export interface ConfirmRequest {
  /** The question, naming the thing: `Delete Game design?` */
  readonly question: string;
  /** What will actually happen if they say yes. */
  readonly consequence: string;
  /** The word on the button that does it. A verb, not `OK`. */
  readonly confirmLabel?: string;
}

/** A line of text the product needs, like the new name for something. */
export interface TextRequest {
  readonly question: string;
  /** What the box is for, on the box. */
  readonly label: string;
  /** What it starts with, which for a rename is the name it has. */
  readonly value?: string;
  readonly confirmLabel?: string;
}

/** A question, and the way back to whoever asked it. */
export type Asked =
  | {
      readonly kind: 'confirm';
      readonly request: ConfirmRequest;
      readonly settle: (said: boolean) => void;
    }
  | {
      readonly kind: 'text';
      readonly request: TextRequest;
      readonly settle: (said: string | null) => void;
    };

/**
 * The one way this product asks a question.
 *
 * There were four ways before: a hand-built dialog on the asset library, a
 * `window.confirm` on the design doc and the release plan, a `window.prompt`
 * for renaming, and nothing at all on the working files, the reference sheet
 * and a card's steps. That is three appearances and one silence for the same
 * question, and the silent ones are the deletions people lose work to.
 *
 * The browser's own are worth naming as the thing that is gone. They block the
 * whole tab, they cannot be styled, they print the page's origin above the
 * question, and their buttons read `OK` and `Cancel` whatever is about to
 * happen. This says the verb.
 */
export function Asking({ asked }: { asked: Asked }): React.JSX.Element {
  return asked.kind === 'confirm' ? (
    <Confirming request={asked.request} settle={asked.settle} />
  ) : (
    <AskingForText request={asked.request} settle={asked.settle} />
  );
}

function Confirming({
  request,
  settle,
}: {
  request: ConfirmRequest;
  settle: (said: boolean) => void;
}): React.JSX.Element {
  // Closing by any route is a no: escape, the backdrop and Cancel all mean the
  // same thing, and a question nobody answered has not been agreed to.
  const dialog = useModalDialog(() => {
    settle(false);
  });

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label={request.question}>
      <div className={styles.body}>
        <h2 className={styles.question}>{request.question}</h2>
        <p className={styles.consequence}>{request.consequence}</p>

        <div className={styles.actions}>
          {/*
            The one dialog where Cancel is not the red one.
            
            Red marks what takes something away, and here that is the other
            button: this dialog exists only to guard a destruction, so backing
            out of it is the safe path. Two reds would be no signal at all, and
            the red on the wrong one would point at the way out.

            Cancel is still first, so the destructive one is not under the thumb
            that was already moving towards the button that opened this.
          */}
          <Button onClick={dialog.close}>Cancel</Button>
          <Button
            tone="stop"
            onClick={() => {
              settle(true);
              dialog.close();
            }}
          >
            {request.confirmLabel ?? 'Delete'}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

function AskingForText({
  request,
  settle,
}: {
  request: TextRequest;
  settle: (said: string | null) => void;
}): React.JSX.Element {
  const [text, setText] = useState(request.value ?? '');
  const dialog = useModalDialog(() => {
    settle(null);
  });

  const answer = (): void => {
    const trimmed = text.trim();

    // An empty box is not a name, and it is what somebody who has changed
    // their mind leaves behind.
    settle(trimmed === '' ? null : trimmed);
    dialog.close();
  };

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label={request.question}>
      <form
        className={styles.body}
        onSubmit={(event) => {
          event.preventDefault();
          answer();
        }}
      >
        <h2 className={styles.question}>{request.question}</h2>

        <Field
          label={request.label}
          value={text}
          autoFocus
          onChange={(event) => {
            setText(event.target.value);
          }}
        />

        <div className={styles.actions}>
          <Button tone="stop" onClick={dialog.close}>
            Cancel
          </Button>
          {/* Submit, so return does what pressing it does — which is the whole
              of how somebody types a name and moves on. */}
          <Button type="submit">{request.confirmLabel ?? 'Save'}</Button>
        </div>
      </form>
    </dialog>
  );
}
