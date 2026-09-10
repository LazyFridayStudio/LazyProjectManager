import type { PermissionGroup, TeamSummary } from '@lpm/shared';
import { useState } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import { Button, useModalDialog } from '../ui/index.js';
import { useSetTeamGroup } from '../../logic/permissions/index.js';
import styles from './AddPermissionDialog.module.css';

/**
 * Every group the team could have, and one press to give it one.
 *
 * Behind a button rather than open on the panel, because what a team already
 * holds is the thing somebody came to read and what it could hold is a list of
 * everything on the install. One of those belongs on the screen; the other
 * belongs where it is asked for.
 *
 * Every group is listed, in a box that scrolls. A studio can have a hundred and
 * they are all already loaded, so there is nothing to gain by making somebody
 * type to see the ninth — the search narrows for anybody who knows what they
 * want, and the list is there for anybody who does not.
 *
 * Picking closes it. A team nearly always has one permission, so staying open
 * for a second would be optimising for the rare case at the cost of a click in
 * the common one.
 */
export function AddPermissionDialog({
  team,
  groups,
  heldIds,
  onClose,
}: {
  readonly team: TeamSummary;
  readonly groups: readonly PermissionGroup[];
  readonly heldIds: ReadonlySet<string>;
  readonly onClose: () => void;
}): React.JSX.Element {
  const dialog = useModalDialog(onClose);

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label="Add permission">
      <AddPermission team={team} groups={groups} heldIds={heldIds} onDone={dialog.close} />
    </dialog>
  );
}

function AddPermission({
  team,
  groups,
  heldIds,
  onDone,
}: {
  readonly team: TeamSummary;
  readonly groups: readonly PermissionGroup[];
  readonly heldIds: ReadonlySet<string>;
  readonly onDone: () => void;
}): React.JSX.Element {
  const [search, setSearch] = useState('');
  const setTeamGroup = useSetTeamGroup();

  // What it already holds is not offered. Adding it again is not a thing, and a
  // list that showed it would be back to being about the ones it has not got.
  const couldHave = groups.filter((group) => !heldIds.has(group.id));
  const offered = matching(couldHave, search);

  return (
    <div className={styles.body}>
      <h2 className={styles.heading}>Add permission</h2>
      <p className={styles.explanation}>
        Give {team.name} one of the permission groups. What it allows is on the Permissions screen.
      </p>

      {couldHave.length > 0 && (
        <input
          className={styles.search}
          type="search"
          value={search}
          autoFocus
          placeholder="Find a group…"
          aria-label="Find a permission group"
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      )}

      {groups.length === 0 && (
        <p className={styles.message}>
          There are no permission groups yet. Make one on Permissions, then come back.
        </p>
      )}

      {groups.length > 0 && offered.length === 0 && (
        <p className={styles.message}>
          {search.trim() === ''
            ? `${team.name} already holds every group there is.`
            : 'No group matches that.'}
        </p>
      )}

      {offered.length > 0 && (
        <p className={styles.howMany}>{describeOffered(offered.length, couldHave.length)}</p>
      )}

      {offered.length > 0 && (
        <ul className={styles.choices}>
          {offered.map((group) => (
            <li key={group.id}>
              <button
                type="button"
                className={styles.choice}
                disabled={setTeamGroup.isPending}
                onClick={() => {
                  setTeamGroup.mutate(
                    { teamId: team.teamId, groupId: group.id, held: true },
                    { onSuccess: onDone },
                  );
                }}
              >
                <span className={styles.choiceName}>{group.name}</span>
                <span className={styles.choiceFacts}>
                  {group.rules.length} {group.rules.length === 1 ? 'rule' : 'rules'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {setTeamGroup.error !== null && (
        <p className={styles.problem} role="alert">
          {describeFailure(setTeamGroup.error)}
        </p>
      )}

      <div className={styles.actions}>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

/**
 * How much is in the box, above the box.
 *
 * A scrolling list hides its own size — three rows and a hundred rows look the
 * same until you drag the bar. Saying so is also how somebody knows a search
 * did anything.
 */
function describeOffered(shown: number, total: number): string {
  if (shown === total) {
    return `${String(total)} ${total === 1 ? 'group' : 'groups'}`;
  }

  return `${String(shown)} of ${String(total)}`;
}

/** Narrowed by what somebody typed, and alphabetical either way. */
function matching(groups: readonly PermissionGroup[], search: string): readonly PermissionGroup[] {
  const wanted = search.trim().toLowerCase();
  const found =
    wanted === '' ? groups : groups.filter((group) => group.name.toLowerCase().includes(wanted));

  return [...found].sort((left, right) => left.name.localeCompare(right.name));
}
