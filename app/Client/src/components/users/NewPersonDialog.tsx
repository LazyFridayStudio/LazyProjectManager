import { useState, type ChangeEvent } from 'react';

import { describeFailure, readFieldProblems } from '../../api/failure-messages.js';
import { Button, Field, useModalDialog } from '../ui/index.js';
import styles from '../projects/NewProjectDialog.module.css';
import { useCreateUser } from '../../logic/people/use-people.js';

/**
 * Adds somebody to the install.
 *
 * The admin sets the first password here rather than an invitation being
 * emailed, because a self-hosted server has no way to send mail until somebody
 * gives it an SMTP account. So the password is typed, read out or pasted into a
 * chat, and changed by its owner once they are in.
 *
 * **A name, an address and a password, and nothing that chooses what they may
 * do** — the same three questions `NewAgentDialog` asks, and for the same
 * reason. This dialog offered a role for longer than permission groups have
 * existed, which made it the last screen in the product giving a second answer
 * to a question the Permissions screen already answers.
 *
 * They arrive able to read this install and nothing more. Everything past that
 * is given deliberately, from the Users screen, which is where what anybody may
 * do is changed for the rest of their time here — so it is where it is decided
 * on the first day too, rather than in one dialog that can only ever say it
 * once.
 */
export function NewPersonDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const dialog = useModalDialog(onClose);

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label="New person">
      <NewPersonForm onDone={dialog.close} />
    </dialog>
  );
}

function NewPersonForm({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const createUser = useCreateUser();
  const problems = readFieldProblems(createUser.error);

  const update =
    (set: (value: string) => void) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      set(event.target.value);
    };

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        createUser.mutate({ email, displayName, password }, { onSuccess: onDone });
      }}
    >
      <h2 className={styles.heading}>New person</h2>
      <p className={styles.explanation}>
        They sign in with this address and this password. There is no invitation email to send —
        hand it over, and they can change it themselves.
      </p>

      <Field
        label="Name"
        autoFocus
        placeholder="Alex Taylor"
        value={displayName}
        onChange={update(setDisplayName)}
        problem={problems.displayName}
      />

      <Field
        label="Email"
        type="email"
        placeholder="a.taylor@example.com"
        value={email}
        onChange={update(setEmail)}
        problem={problems.email}
      />

      <Field
        label="First password"
        type="password"
        value={password}
        onChange={update(setPassword)}
        hint="At least 12 characters. They change it once they are in."
        problem={problems.password}
      />

      {createUser.error !== null && Object.keys(problems).length === 0 && (
        <p className={styles.problem} role="alert">
          {describeFailure(createUser.error)}
        </p>
      )}

      <div className={styles.actions}>
        <Button tone="stop" onClick={onDone}>
          Cancel
        </Button>
        <Button tone="go" type="submit" busy={createUser.isPending} busyLabel="Adding…">
          Add person
        </Button>
      </div>
    </form>
  );
}
