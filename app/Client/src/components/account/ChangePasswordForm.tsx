import { useState } from 'react';

import { describeFailure, readFieldProblems } from '../../api/failure-messages.js';
import { Button, Field, useDisplay } from '../ui/index.js';
import { useChangePassword } from '../../logic/people/use-people.js';
import styles from './AccountDialog.module.css';

/**
 * Changes your own password.
 *
 * Everybody arrives with a password an admin typed, so everybody needs this.
 * The current one is asked for even though the session already proves who you
 * are: it is what stops a borrowed unlocked laptop becoming a permanent
 * account.
 *
 * It was a dialog of its own, opened from a button in the header of every
 * screen outside a project — which meant somebody who could not reach that
 * header could not change their password at all. It is a section of the account
 * window now, beside the other things that are yours.
 */
export function ChangePasswordForm({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const change = useChangePassword();
  const { showInfo } = useDisplay();
  const problems = readFieldProblems(change.error);

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        change.mutate(
          { currentPassword, newPassword },
          {
            onSuccess: () => {
              showInfo('Your password is changed. Every other browser has been signed out.');
              onDone();
            },
          },
        );
      }}
    >
      <p className={styles.aside}>
        Every other browser you are signed in on is signed out. This one stays.
      </p>

      <Field
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={currentPassword}
        onChange={(event) => {
          setCurrentPassword(event.target.value);
        }}
        problem={problems.currentPassword}
      />

      <Field
        label="New password"
        type="password"
        autoComplete="new-password"
        value={newPassword}
        onChange={(event) => {
          setNewPassword(event.target.value);
        }}
        hint="At least 12 characters."
        problem={problems.newPassword}
      />

      {change.error !== null && Object.keys(problems).length === 0 && (
        <p className={styles.problem} role="alert">
          {describeFailure(change.error)}
        </p>
      )}

      <div className={styles.formActions}>
        <Button tone="go" type="submit" busy={change.isPending} busyLabel="Changing…">
          Change password
        </Button>
      </div>
    </form>
  );
}
