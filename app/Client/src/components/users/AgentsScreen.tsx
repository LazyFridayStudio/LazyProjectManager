import { useState } from 'react';

import { Button, Loading } from '../ui/index.js';
import { describeFailure } from '../../api/failure-messages.js';
import { InstallShell } from '../shell/InstallShell.js';
import { PickLayout, PickList, type Pickable } from '../shell/PickList.js';
import { AgentKeysPanel } from './AgentKeysPanel.js';
import { AgentPermissionsPanel } from './AgentPermissionsPanel.js';
import { AgentSettingsPanel } from './AgentSettingsPanel.js';
import { ConnectingAClient } from './ConnectingAClient.js';
import { NewAgentDialog } from './NewAgentDialog.js';
import { UsersTabs } from './UsersTabs.js';
import { useAgents } from '../../logic/auth/use-agents.js';
import styles from './AgentsSection.module.css';

/**
 * The agents on this install, and how something outside the app reaches it.
 *
 * The list down the side and the one you picked beside it, which is how Teams
 * and Permissions read. The same `PickList`, so the three screens are the same
 * shape by construction rather than by three stylesheets that happen to agree —
 * and an agent has as much to say about it as a team does, which is more than
 * fits on a row.
 *
 * Its own screen beside the people rather than a panel under them. Almost
 * nothing a person's row offers means anything on an agent — no password to
 * reset, no address to write to — and almost nothing an agent needs means
 * anything on a person.
 */
export function AgentsScreen(): React.JSX.Element {
  const [isAdding, setIsAdding] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const agents = useAgents();

  const listed = agents.data?.agents ?? [];
  // The picked one, or the first, so the panels are never empty beside a list
  // that is not.
  const picked = listed.find((agent) => agent.userId === pickedId) ?? listed[0] ?? null;

  return (
    <InstallShell
      active="users"
      title="Agents"
      actions={
        <>
          <UsersTabs active="agents" />
          <Button
            tone="go"
            onClick={() => {
              setIsAdding(true);
            }}
          >
            New agent
          </Button>
        </>
      }
    >
      {agents.isPending && <Loading />}

      {agents.isError && (
        <p className={styles.problem} role="alert">
          {describeFailure(agents.error)}
        </p>
      )}

      {agents.isSuccess && listed.length === 0 && (
        <section className={styles.panel} aria-label="Agents">
          <p className={styles.about}>
            No agents yet. An agent reaches this install with a key rather than a password, does
            what its permission groups allow and nothing else, and appears in the audit trail under
            its own name.
          </p>
        </section>
      )}

      {picked !== null && (
        <PickLayout
          list={
            <PickList
              label="Agents"
              items={listed.map((agent): Pickable => ({
                id: agent.userId,
                name: agent.displayName,
                // What it would otherwise take opening the thing to find out.
                facts: `${describeCount(agent.tokens.filter((token) => token.revokedAt === null).length, 'key', 'keys')} · ${describeCount(agent.permissionGroups.length, 'permission', 'permissions')}`,
              }))}
              pickedId={picked.userId}
              onPick={setPickedId}
            />
          }
        >
          <AgentSettingsPanel agent={picked} />
          <AgentPermissionsPanel agent={picked} />
          <AgentKeysPanel agent={picked} />
          <ConnectingAClient />
        </PickLayout>
      )}

      {isAdding && (
        <NewAgentDialog
          onClose={() => {
            setIsAdding(false);
          }}
        />
      )}
    </InstallShell>
  );
}

/** `no keys`, `1 key`, `3 keys` — the second line of a row, read by scanning. */
function describeCount(count: number, one: string, many: string): string {
  if (count === 0) return `no ${many}`;

  return `${String(count)} ${count === 1 ? one : many}`;
}
