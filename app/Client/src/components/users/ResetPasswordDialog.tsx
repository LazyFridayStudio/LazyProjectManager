import type { Person } from '@lpm/shared';
import { useState } from 'react';

import { describeFailure, readFieldProblems } from '../../api/failure-messages.js';
import { Button, Field, useModalDialog } from '../ui/index.js';
import styles from '../projects/NewProjectDialog.module.css';
import { useResetUserPassword } from '../../logic/people/use-people.js';

/**
 * Sets somebody else's password.
 *
 * The way back in, on a server that cannot send a reset link. Whoever asked for
 * it is signed out of everywhere while this happens, which is the point: a
 * password nobody knows the old value of is not a password until the sessions
 * that were using it are gone.
 */
export function ResetPasswordDialog({
  person,
  onClose,
}: {
  readonly person: Person;
  readonly onClose: () => void;
}): React.JSX.Element {
  const dialog = useModalDialog(onClose);

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label="Reset password">
      <ResetPasswordForm person={person} onDone={dialog.close} />
    </dialog>
  );
}

function ResetPasswordForm({
  person,
  onDone,
}: {
  readonly person: Person;
  readonly onDone: () => void;
}): React.JSX.Element {
  const [password, setPassword] = useState('');
  const reset = useResetUserPassword();
  const problems = readFieldProblems(reset.error);

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        reset.mutate({ userId: person.userId, password }, { onSuccess: onDone });
      }}
    >
      <h2 className={styles.heading}>Reset {person.displayName}’s password</h2>
      <p className={styles.explanation}>
        They are signed out everywhere, and sign back in with this. Read it to them rather than
        leaving it somewhere.
      </p>

      <Field
        label="New password"
        type="password"
        autoFocus
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
        }}
        hint="At least 12 characters."
        problem={problems.password}
      />

      {reset.error !== null && Object.keys(problems).length === 0 && (
        <p className={styles.problem} role="alert">
          {describeFailure(reset.error)}
        </p>
      )}

      <div className={styles.actions}>
        <Button tone="stop" onClick={onDone}>
          Cancel
        </Button>
        <Button tone="go" type="submit" busy={reset.isPending} busyLabel="Resetting…">
          Reset password
        </Button>
      </div>
    </form>
  );
}
