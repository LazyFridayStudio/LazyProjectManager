import { useState } from 'react';

import { describeFailure, readFieldProblems } from '../../api/failure-messages.js';
import { Button, Field, useModalDialog } from '../ui/index.js';
import styles from '../projects/NewProjectDialog.module.css';
import { useCreateTeam } from '../../logic/teams/use-teams.js';

/**
 * Makes a team.
 *
 * One field, because a team is a name until somebody is in it. The lead is
 * chosen from its members afterwards, and a team has none yet.
 */
export function NewTeamDialog({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void;
  readonly onCreated: (teamId: string) => void;
}): React.JSX.Element {
  const dialog = useModalDialog(onClose);

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label="New team">
      <NewTeamForm onDone={dialog.close} onCreated={onCreated} />
    </dialog>
  );
}

function NewTeamForm({
  onDone,
  onCreated,
}: {
  readonly onDone: () => void;
  readonly onCreated: (teamId: string) => void;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const createTeam = useCreateTeam();
  const problems = readFieldProblems(createTeam.error);

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        createTeam.mutate(
          { name },
          {
            onSuccess: (created) => {
              // Opened on the new team, so the next thing — putting somebody in
              // it — is where the eye already is.
              if (created.id !== undefined) {
                onCreated(created.id);
              }

              onDone();
            },
          },
        );
      }}
    >
      <h2 className={styles.heading}>New team</h2>
      <p className={styles.explanation}>
        It starts with nobody in it. Add the people, then say who leads them.
      </p>

      <Field
        label="Name"
        autoFocus
        placeholder="Environment art"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
        problem={problems.name}
      />

      {createTeam.error !== null && Object.keys(problems).length === 0 && (
        <p className={styles.problem} role="alert">
          {describeFailure(createTeam.error)}
        </p>
      )}

      <div className={styles.actions}>
        <Button tone="stop" onClick={onDone}>
          Cancel
        </Button>
        <Button tone="go" type="submit" busy={createTeam.isPending} busyLabel="Making…">
          Make team
        </Button>
      </div>
    </form>
  );
}
