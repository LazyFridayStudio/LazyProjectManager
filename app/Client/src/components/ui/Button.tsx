import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { joinClassNames } from '../../lib/join-class-names.js';
import styles from './Button.module.css';

/**
 * What kind of thing pressing this does.
 *
 * Only two, and neither is the default. Most buttons are neither — Save, Add,
 * Close, Done — and a colour on all of them would leave nothing for the ones
 * that need it.
 *
 * `stop` is for anything that takes something away, refuses, or abandons what
 * somebody was doing: Delete, Remove, Disconnect, Cancel. `go` is for the other
 * half of one of those pairs — Put it back beside Delete for good, Let back in
 * beside Suspend. On its own, without an opposite in view, an action is neither.
 */
export type ButtonTone = 'go' | 'stop';

/**
 * How much room the button takes, which is not how loud it is.
 *
 * Not the `variant` scale that was here once and went: that asked every call
 * site how important its button was, which nobody could answer twice the same
 * way. This asks where it sits. A control in a row of chips cannot be
 * thirty-six pixels tall without the row becoming a row of buttons with chips
 * between them, and a control in a dialog footer cannot be twenty without
 * looking like a link.
 */
export type ButtonSize = 'regular' | 'compact';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  readonly children: ReactNode;
  /**
   * Shows progress and blocks further presses. Separate from `disabled` so the
   * button can say what it is doing rather than only that it is unavailable.
   */
  readonly busy?: boolean;
  readonly busyLabel?: string;
  /** Green for the half that lets something happen, red for the half that undoes it. */
  readonly tone?: ButtonTone;
  /** `compact` for a button among chips, which a full-sized one would tower over. */
  readonly size?: ButtonSize;
}

/**
 * A button is the accent orange unless it means yes or no.
 *
 * There was a `variant` here once — primary, standard, ghost — and it went,
 * because every call site set one and nothing read them. `tone` is not that: it
 * is read, it is unset on most buttons, and it says what pressing this does
 * rather than how loud it should look.
 *
 * Red is anything that takes something away or abandons what you were doing.
 * Green is the other half of such a pair. Everything else is the accent, which
 * is what this product looks like.
 *
 * Where a screen needs to say that one action matters more than the others, it
 * says so with position and wording, which is where that belongs.
 */
export function Button({
  children,
  busy = false,
  busyLabel,
  tone,
  size,
  disabled,
  type = 'button',
  ...buttonProps
}: ButtonProps): React.JSX.Element {
  return (
    <button
      {...buttonProps}
      type={type === 'submit' ? 'submit' : 'button'}
      disabled={disabled === true || busy}
      // Announce the change to assistive technology without moving focus, which
      // would throw the user out of the form mid-submit.
      aria-busy={busy}
      className={joinClassNames(
        styles.button,
        size === 'compact' && styles.compact,
        tone === 'go' && styles.go,
        tone === 'stop' && styles.stop,
      )}
    >
      {busy && busyLabel !== undefined ? busyLabel : children}
    </button>
  );
}
