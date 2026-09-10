import type { PermissionGroup } from '@lpm/shared';
import { useState } from 'react';

import { describeFailure, readFieldProblems } from '../../api/failure-messages.js';
import { Button, ButtonIcon, Field, TrashIcon, useDisplay, useModalDialog } from '../ui/index.js';
import styles from '../projects/NewProjectDialog.module.css';
import { useDeleteGroup, useRenameGroup } from '../../logic/permissions/index.js';

/**
 * What a group is called, and the way to take it away.
 *
 * Both were in the content area, above the rules — a rename box and a Delete
 * button sitting on top of the thing somebody came to that screen to read. They
 * are not what the screen is for: naming a group happens once and deleting one
 * happens less, while reading what it allows happens every time.
 *
 * So they are one button beside New permission group, and this is behind it.
 * Delete lives here rather than in the header for the same reason it lives in a
 * confirmation: it is the one thing on this screen that cannot be undone.
 */
export function EditPermissionGroupDialog({
  group,
  onClose,
  onDeleted,
}: {
  readonly group: PermissionGroup;
  readonly onClose: () => void;
  readonly onDeleted: () => void;
}): React.JSX.Element {
  const dialog = useModalDialog(onClose);

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label="Edit permission group">
      <EditPermissionGroupForm group={group} onDone={dialog.close} onDeleted={onDeleted} />
    </dialog>
  );
}

function EditPermissionGroupForm({
  group,
  onDone,
  onDeleted,
}: {
  readonly group: PermissionGroup;
  readonly onDone: () => void;
  readonly onDeleted: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(group.name);
  const rename = useRenameGroup();
  const remove = useDeleteGroup();
  const { askToConfirm } = useDisplay();
  const problems = readFieldProblems(rename.error);

  const deleteIt = (): void => {
    void (async () => {
      const said = await askToConfirm({
        question: `Delete ${group.name}?`,
        consequence:
          group.teams.length === 0
            ? 'The group and its rules go. No team is holding it, so nobody notices.'
            : `The group and its rules go, and ${String(group.teams.length)} ${group.teams.length === 1 ? 'team stops' : 'teams stop'} being governed by it. What those people may do goes back to what their role says.`,
      });

      if (!said) return;

      remove.mutate(
        { groupId: group.id },
        {
          onSuccess: () => {
            onDeleted();
            onDone();
          },
        },
      );
    })();
  };

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        rename.mutate({ groupId: group.id, name }, { onSuccess: onDone });
      }}
    >
      <h2 className={styles.heading}>Edit permission group</h2>
      <p className={styles.explanation}>
        What it allows is on the screen behind this. A name is the only thing about a group that is
        not a rule.
      </p>

      <Field
        label="Name"
        autoFocus
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
        problem={problems.name}
      />

      {rename.error !== null && Object.keys(problems).length === 0 && (
        <p className={styles.problem} role="alert">
          {describeFailure(rename.error)}
        </p>
      )}

      {remove.error !== null && (
        <p className={styles.problem} role="alert">
          {describeFailure(remove.error)}
        </p>
      )}

      <div className={styles.actions}>
        {/* Furthest from Save, and behind a confirmation that says how many
            people it changes. The one thing on this screen with no way back. */}
        <Button
          tone="stop"
          aria-label="Delete group"
          title="Delete group"
          onClick={deleteIt}
          busy={remove.isPending}
        >
          <ButtonIcon>
            <TrashIcon size={14} />
          </ButtonIcon>
        </Button>
        <Button tone="stop" onClick={onDone}>
          Cancel
        </Button>
        <Button
          tone="go"
          type="submit"
          disabled={name.trim() === '' || name === group.name}
          busy={rename.isPending}
          busyLabel="Saving…"
        >
          Save name
        </Button>
      </div>
    </form>
  );
}
