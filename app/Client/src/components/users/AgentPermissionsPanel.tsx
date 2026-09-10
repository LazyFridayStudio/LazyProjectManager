import type { Agent } from '@lpm/shared';
import { useState } from 'react';

import { Button, Select } from '../ui/index.js';
import { describeFailure } from '../../api/failure-messages.js';
import { usePermissions } from '../../logic/permissions/index.js';
import { useSetUserGroup } from '../../logic/people/use-people.js';
import styles from './AgentsSection.module.css';

/**
 * What an agent may do, which is the whole of what it may do.
 *
 * Nothing else decides it. There is no role beside this to disagree with it,
 * and an agent holding none can read the install and take no action at all —
 * which is the state it is made in, so everything it ever does is something
 * somebody deliberately allowed.
 *
 * The same panel shape a team's permissions have, because it is the same
 * question asked of a different holder. Without the ordering: a team's groups
 * are dragged into the order a studio reads them in, and one agent's handful
 * has no order worth keeping.
 */
export function AgentPermissionsPanel({ agent }: { readonly agent: Agent }): React.JSX.Element {
  const [adding, setAdding] = useState('');
  const permissions = usePermissions();
  const setUserGroup = useSetUserGroup();

  const all = permissions.data?.groups ?? [];
  const held = new Set(agent.permissionGroups.map((group) => group.groupId));
  const rest = all.filter((group) => !held.has(group.id));

  return (
    <section className={styles.panel} aria-label="Permissions">
      <h2 className={styles.heading}>
        Permissions
        {/* Only once there is something to count. The paragraph below says what
            holding none means, and saying it twice on one line is a heading
            arguing with the sentence under it. */}
        {agent.permissionGroups.length > 0 && (
          <span className={styles.meta}>{String(agent.permissionGroups.length)} held</span>
        )}
      </h2>

      {agent.permissionGroups.length === 0 && (
        <p className={styles.about}>
          It can read this install and take no action at all. Give it a permission group to let it
          do something — the same groups a person holds.
        </p>
      )}

      {agent.permissionGroups.length > 0 && (
        <ul className={styles.groups}>
          {agent.permissionGroups.map((group) => (
            <li key={group.groupId} className={styles.group}>
              <span className={styles.groupName}>{group.name}</span>

              <Button
                tone="stop"
                onClick={() => {
                  setUserGroup.mutate({
                    userId: agent.userId,
                    groupId: group.groupId,
                    held: false,
                  });
                }}
              >
                Take away
              </Button>
            </li>
          ))}
        </ul>
      )}

      {rest.length > 0 && (
        <div className={styles.adding}>
          <Select
            label="Add a permission group"
            options={[
              { value: '', label: 'Choose one…' },
              ...rest.map((group) => ({ value: group.id, label: group.name })),
            ]}
            value={adding}
            onChange={(event) => {
              const groupId = event.target.value;

              setAdding('');

              if (groupId !== '') {
                setUserGroup.mutate({ userId: agent.userId, groupId, held: true });
              }
            }}
          />
        </div>
      )}

      {setUserGroup.isError && (
        <p className={styles.problem} role="alert">
          {describeFailure(setUserGroup.error)}
        </p>
      )}
    </section>
  );
}
