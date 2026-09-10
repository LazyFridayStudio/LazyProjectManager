import { describeFailure } from '../../api/failure-messages.js';
import { usePermissions } from '../../logic/permissions/index.js';
import styles from './PermissionGroupChoices.module.css';

interface PermissionGroupChoicesProps {
  /** The groups switched on, by id. */
  readonly held: ReadonlySet<string>;
  readonly onToggle: (groupId: string, held: boolean) => void;
}

/**
 * Every permission group, with a switch each.
 *
 * The one way this product asks what somebody may do. It was written twice —
 * once on the dialog that changes a person's groups, and it would have been
 * written a third time on the dialog that makes one — and the copies would have
 * been the place the two screens came to disagree about what an install with no
 * groups yet should say.
 *
 * The whole row is the label, so the name and the count are both a target: a
 * checkbox on its own is nine pixels of something to hit.
 *
 * It asks the server for the groups itself. The alternative was every caller
 * passing them in, and then every caller also deciding what to draw while they
 * were loading and what to say when the request was refused — which is three
 * decisions each, made three times.
 */
export function PermissionGroupChoices({
  held,
  onToggle,
}: PermissionGroupChoicesProps): React.JSX.Element {
  const permissions = usePermissions();
  const groups = permissions.data?.groups ?? [];

  if (permissions.isPending) {
    return <p className={styles.message}>Loading the groups…</p>;
  }

  if (permissions.isError) {
    return (
      <p className={styles.problem} role="alert">
        {describeFailure(permissions.error)}
      </p>
    );
  }

  if (groups.length === 0) {
    return (
      <p className={styles.message}>
        There are no permission groups yet. Make one on Permissions, then come back.
      </p>
    );
  }

  return (
    <ul className={styles.groups}>
      {groups.map((group) => (
        <li key={group.id}>
          <label className={styles.group}>
            <input
              type="checkbox"
              checked={held.has(group.id)}
              onChange={(event) => {
                onToggle(group.id, event.target.checked);
              }}
            />
            <span className={styles.groupName}>{group.name}</span>
            <span className={styles.groupFacts}>
              {group.rules.length} {group.rules.length === 1 ? 'rule' : 'rules'}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}
