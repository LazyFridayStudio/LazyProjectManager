import type { PermissionCatalogue } from '@lpm/shared';
import { useState } from 'react';

import { describeFailure, readFieldProblems } from '../../api/failure-messages.js';
import { Button, Field, Select, useModalDialog } from '../ui/index.js';
import styles from '../projects/NewProjectDialog.module.css';
import { useCreateGroup, useSetRule } from '../../logic/permissions/index.js';

const NOTHING_YET = '';

/**
 * Makes a permission group.
 *
 * A dialog rather than a field wedged into the header, for the reason the teams
 * screen has one: naming a thing and setting it up is two steps, and a header
 * has room for a button.
 */
export function NewPermissionGroupDialog({
  catalogues,
  onClose,
  onCreated,
}: {
  readonly catalogues: readonly PermissionCatalogue[];
  readonly onClose: () => void;
  readonly onCreated: (groupId: string) => void;
}): React.JSX.Element {
  const dialog = useModalDialog(onClose);

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label="New permission group">
      <NewPermissionGroupForm catalogues={catalogues} onDone={dialog.close} onCreated={onCreated} />
    </dialog>
  );
}

function NewPermissionGroupForm({
  catalogues,
  onDone,
  onCreated,
}: {
  readonly catalogues: readonly PermissionCatalogue[];
  readonly onDone: () => void;
  readonly onCreated: (groupId: string) => void;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const [startingWith, setStartingWith] = useState(NOTHING_YET);
  const create = useCreateGroup();
  const setRule = useSetRule();
  const problems = readFieldProblems(create.error);

  /*
   * A catalogue to begin with, or nothing.
   *
   * Headings only. Starting a group from one of the nineteen single actions is
   * a choice somebody makes in the group itself, where the action sits next to
   * the others it is being chosen over.
   */
  const startingPoints = [
    { value: NOTHING_YET, label: 'Nothing yet — I will fill it in' },
    ...catalogues.map((catalogue) => ({
      value: catalogue.value,
      label: `Allow everything under ${catalogue.label}`,
    })),
  ];

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate(
          { name },
          {
            onSuccess: (created) => {
              if (created.id === undefined) {
                onDone();
                return;
              }

              /*
               * One command per action, because a catalogue is a heading and
               * not a rule — allowing one means allowing the things under it.
               *
               * Separate from the create on purpose: making the group and
               * saying what it allows are two things, and a create that also
               * wrote rules would be a create nobody could predict.
               */
              const chosen = catalogues.find((catalogue) => catalogue.value === startingWith);

              for (const action of chosen?.actions ?? []) {
                setRule.mutate({
                  groupId: created.id,
                  subject: action.value,
                  effect: 'allow',
                });
              }

              // Opened on the new group, so the next thing — saying what else
              // it allows, and who holds it — is where the eye already is.
              onCreated(created.id);
              onDone();
            },
          },
        );
      }}
    >
      <h2 className={styles.heading}>New permission group</h2>
      <p className={styles.explanation}>
        A group is a set of things a team may and may not do. It governs nobody until a team holds
        it, so nothing changes for anybody until you say so.
      </p>

      <Field
        label="Name"
        autoFocus
        placeholder="Outsourcer"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
        problem={problems.name}
      />

      <Select
        label="Start it with"
        value={startingWith}
        options={startingPoints}
        onChange={(event) => {
          setStartingWith(event.target.value);
        }}
      />

      {create.error !== null && Object.keys(problems).length === 0 && (
        <p className={styles.problem} role="alert">
          {describeFailure(create.error)}
        </p>
      )}

      <div className={styles.actions}>
        <Button tone="stop" onClick={onDone}>
          Cancel
        </Button>
        <Button tone="go" type="submit" busy={create.isPending} busyLabel="Making…">
          Make group
        </Button>
      </div>
    </form>
  );
}
