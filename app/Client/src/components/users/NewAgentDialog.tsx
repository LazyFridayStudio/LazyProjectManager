import { useState } from 'react';

import { Button, Field, useModalDialog } from '../ui/index.js';
import { describeFailure, readFieldProblems } from '../../api/failure-messages.js';
import { useCreateAgent } from '../../logic/auth/use-agents.js';
import styles from '../projects/NewProjectDialog.module.css';

/**
 * Makes an agent.
 *
 * A name, and nothing else. No address and no password, because it does not
 * sign in — and **nothing that chooses what it may do**, because that is what
 * permission groups are for. Offering a second way to answer the same question
 * would give a studio two answers that disagree the first time somebody uses
 * one and not the other.
 *
 * It is made able to read and nothing more. Everything past that is given
 * deliberately on the permissions screen, which is where what anybody may do is
 * decided.
 */
export function NewAgentDialog({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const dialog = useModalDialog(onClose);

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label="New agent">
      <NewAgentForm onDone={dialog.close} />
    </dialog>
  );
}

function NewAgentForm({ onDone }: { readonly onDone: () => void }): React.JSX.Element {
  const [displayName, setDisplayName] = useState('');
  const createAgent = useCreateAgent();
  const problems = readFieldProblems(createAgent.error);

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        createAgent.mutate({ displayName }, { onSuccess: onDone });
      }}
    >
      <Field
        label="Name"
        value={displayName}
        onChange={(event) => {
          setDisplayName(event.target.value);
        }}
        hint="What it is called in the audit trail and on a card."
        problem={problems.displayName}
      />

      <p className={styles.explanation}>
        It will be able to read this install and nothing else. Give it permission groups to let it
        do anything — the same way you would for a person.
      </p>

      {createAgent.error !== null && Object.keys(problems).length === 0 && (
        <p className={styles.problem} role="alert">
          {describeFailure(createAgent.error)}
        </p>
      )}

      <div className={styles.actions}>
        <Button tone="stop" onClick={onDone}>
          Cancel
        </Button>
        <Button tone="go" type="submit" busy={createAgent.isPending} busyLabel="Adding…">
          Add agent
        </Button>
      </div>
    </form>
  );
}
