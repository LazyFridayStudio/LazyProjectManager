import { useState } from 'react';

import { useRequiredIdentity } from '../../logic/auth/use-identity.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import { AccountDialog } from './AccountDialog.js';
import styles from './AccountButton.module.css';

/**
 * How much of yourself the shell has room to draw.
 *
 * `full` is the block at the foot of a project's sidebar: your picture, your
 * name and what you are on the install. `compact` is the corner of every screen
 * outside one, where the row of places is already using the width.
 */
export type AccountButtonSize = 'full' | 'compact';

/**
 * You, and the way into everything about you.
 *
 * The same control in both shells, because it is the same thing: it was a block
 * of text at the foot of a sidebar that did nothing, and a pair of buttons in a
 * header — Change password and Sign out — that spent the end of every screen on
 * two things you rarely do.
 *
 * Both are this now. Pressing it opens the account window, which is where the
 * password went and where signing out went with it.
 */
export function AccountButton({ size }: { size: AccountButtonSize }): React.JSX.Element {
  const identity = useRequiredIdentity();
  const [isOpen, setIsOpen] = useState(false);
  const role = identity.memberships[0]?.role ?? 'member';

  return (
    <>
      <button
        type="button"
        className={joinClassNames(styles.account, size === 'compact' && styles.compact)}
        title={identity.user.displayName}
        /* Not `Your account, Alex Taylor`. An accessible name matches on a
           substring, and the timeline draws a button per person — so putting
           somebody's name in here makes every search for that person find two
           things, one of which is the corner of the screen. */
        aria-label="Your account"
        aria-haspopup="dialog"
        onClick={() => {
          setIsOpen(true);
        }}
      >
        <Face />

        {size === 'full' && (
          <span className={styles.names}>
            <span className={styles.name}>{identity.user.displayName}</span>
            <span className={styles.role}>{role}</span>
          </span>
        )}
      </button>

      {isOpen && (
        <AccountDialog
          onClose={() => {
            setIsOpen(false);
          }}
        />
      )}
    </>
  );
}

/**
 * Your picture, or your initials until there is one.
 *
 * `aria-hidden` on both: the button already says whose account it is, and a
 * screen reader reading "AT" after "Your account, Alex Taylor" is reading the
 * same fact twice in a worse voice.
 */
function Face(): React.JSX.Element {
  const identity = useRequiredIdentity();

  if (identity.user.avatarUrl === null) {
    return (
      <span className={styles.face} aria-hidden>
        {identity.user.initials}
      </span>
    );
  }

  return <img className={styles.face} src={identity.user.avatarUrl} alt="" aria-hidden />;
}
