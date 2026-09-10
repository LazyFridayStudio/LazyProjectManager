/**
 * Anybody whose permission groups can be switched here.
 *
 * A person or an agent. Deliberately narrower than either — the dialog needs a
 * name, an id and what they hold, and nothing else, so both can be handed to it
 * without one of them pretending to be the other.
 */
export interface SomebodyWithGroups {
  readonly userId: string;
  readonly displayName: string;
  readonly permissionGroups: readonly { readonly groupId: string; readonly name: string }[];
  /** Teams reach a person and never an agent, so this is absent for one. */
  readonly teams?: readonly string[];
}
import { useState } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import { useSetUserGroup } from '../../logic/people/use-people.js';
import { PermissionGroupChoices } from '../permissions/PermissionGroupChoices.js';
import { Button, useModalDialog } from '../ui/index.js';
import styles from './PersonGroupsDialog.module.css';

/**
 * What one person may do, as the groups they hold.
 *
 * Every group on one list with a switch each, rather than the two flows a team
 * has — a dialog to add and a row to remove. A team's permissions are a panel
 * somebody is already looking at; a person's are a cell in a table, and the
 * question asked of a cell is "what has this one got", which one list answers
 * and two do not.
 *
 * Only the groups held in their own right are switched here. What reaches them
 * through a team belongs to the team, is changed on Teams, and is shown here
 * only so nobody wonders why somebody can do a thing this dialog does not
 * mention.
 */
export function PersonGroupsDialog({
  person,
  onClose,
}: {
  readonly person: SomebodyWithGroups;
  readonly onClose: () => void;
}): React.JSX.Element {
  const dialog = useModalDialog(onClose);
  const setUserGroup = useSetUserGroup();

  /*
   * Kept here, and moved the moment the switch is pressed.
   *
   * The list this dialog was opened with is a snapshot — the screen behind it
   * refetches, but the person handed to this component does not change — so
   * reading the answer off the props would leave a switch that does not move
   * when it is pressed, and a switch that does not move gets pressed again.
   *
   * Put back if the command refuses, which is the only case where what is on
   * screen and what the server holds could otherwise disagree.
   */
  const [held, setHeld] = useState(
    () => new Set(person.permissionGroups.map((group) => group.groupId)),
  );

  const toggle = (groupId: string, wanted: boolean): void => {
    setHeld((current) => {
      const next = new Set(current);

      if (wanted) next.add(groupId);
      else next.delete(groupId);

      return next;
    });

    setUserGroup.mutate(
      { userId: person.userId, groupId, held: wanted },
      {
        onError: () => {
          setHeld((current) => {
            const back = new Set(current);

            if (wanted) back.delete(groupId);
            else back.add(groupId);

            return back;
          });
        },
      },
    );
  };

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label={person.displayName}>
      <div className={styles.body}>
        <h2 className={styles.heading}>What {person.displayName} may do</h2>
        <p className={styles.explanation}>
          The groups they hold in their own right. What each one allows is on the Permissions
          screen.
        </p>

        <PermissionGroupChoices held={held} onToggle={toggle} />

        {setUserGroup.isError && (
          <p className={styles.problem} role="alert">
            {describeFailure(setUserGroup.error)}
          </p>
        )}

        {/* Through their teams as well, and not switchable here: a team's
            permissions are the team's, and a switch that turned one off for one
            person would be a promise this cannot keep. */}
        {person.teams !== undefined && person.teams.length > 0 && (
          <p className={styles.throughTeams}>
            They are in {person.teams.join(', ')}, and hold whatever those teams do.
          </p>
        )}

        <div className={styles.actions}>
          <Button onClick={dialog.close}>Done</Button>
        </div>
      </div>
    </dialog>
  );
}
