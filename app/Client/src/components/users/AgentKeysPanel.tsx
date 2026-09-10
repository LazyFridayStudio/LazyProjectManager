import type { Agent, AgentToken } from '@lpm/shared';
import { useState } from 'react';

import { Button } from '../ui/index.js';
import { describeFailure } from '../../api/failure-messages.js';
import { formatTimeAgo } from '../../logic/projects/format-project-values.js';
import { useIssueAgentToken, useRevokeAgentToken } from '../../logic/auth/use-agents.js';
import styles from './AgentsSection.module.css';

/**
 * The keys an agent holds, and the way to make another.
 *
 * A key is how it says who it is. Revoked ones stay listed, struck through: one
 * that vanished would leave somebody wondering whether they had revoked it or
 * imagined it.
 */
export function AgentKeysPanel({ agent }: { readonly agent: Agent }): React.JSX.Element {
  const [isNaming, setIsNaming] = useState(false);

  return (
    <section className={styles.panel} aria-label="Keys">
      <h2 className={styles.heading}>
        Keys
        <Button
          tone="go"
          onClick={() => {
            setIsNaming(true);
          }}
        >
          New key
        </Button>
      </h2>

      {agent.tokens.length === 0 && !isNaming && (
        <p className={styles.about}>
          No keys yet. Without one, nothing can reach this install as {agent.displayName}.
        </p>
      )}

      {isNaming && (
        <NewKey
          agent={agent}
          onDone={() => {
            setIsNaming(false);
          }}
        />
      )}

      {agent.tokens.length > 0 && (
        <ul className={styles.keys}>
          {agent.tokens.map((token) => (
            <KeyRow key={token.id} token={token} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Making a key, and the one moment its secret exists.
 *
 * Shown until it is dismissed rather than for a few seconds: somebody who has
 * just made a key is about to paste it somewhere, and a message that vanished
 * while they were switching windows would mean revoking it and starting again.
 */
function NewKey({
  agent,
  onDone,
}: {
  readonly agent: Agent;
  readonly onDone: () => void;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const issue = useIssueAgentToken();
  const secret = issue.data;

  if (secret !== undefined) {
    return (
      <div className={styles.secret}>
        <p className={styles.secretSaid}>
          Copy this now. It is the only time it will be shown — nothing stores it, so it cannot be
          read again.
        </p>
        <code className={styles.secretValue}>{secret}</code>
        <Button onClick={onDone}>Done</Button>
      </div>
    );
  }

  return (
    <div className={styles.naming}>
      <input
        className={styles.nameBox}
        type="text"
        aria-label="What this key is for"
        placeholder="What it is for — the laptop, the build box"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />

      <Button
        tone="go"
        busy={issue.isPending}
        busyLabel="Making…"
        onClick={() => {
          if (name.trim() !== '') {
            issue.mutate({ userId: agent.userId, name: name.trim() });
          }
        }}
      >
        Make key
      </Button>

      <Button tone="stop" onClick={onDone}>
        Cancel
      </Button>

      {issue.isError && (
        <p className={styles.problem} role="alert">
          {describeFailure(issue.error)}
        </p>
      )}
    </div>
  );
}

/** One key: what it is for, whether anything has used it, and the way to stop it. */
function KeyRow({ token }: { readonly token: AgentToken }): React.JSX.Element {
  const revoke = useRevokeAgentToken();
  const isRevoked = token.revokedAt !== null;

  return (
    <li className={styles.key}>
      <span className={isRevoked ? styles.revokedName : undefined}>{token.name}</span>

      <span className={styles.keyMeta}>
        {isRevoked
          ? `Stopped ${formatTimeAgo(token.revokedAt ?? '')}`
          : // The question somebody asks of a list of keys is which still matter.
            token.lastUsedAt === null
            ? 'Never used'
            : `Last used ${formatTimeAgo(token.lastUsedAt)}`}
      </span>

      {!isRevoked && (
        <Button
          tone="stop"
          busy={revoke.isPending}
          busyLabel="Stopping…"
          onClick={() => {
            revoke.mutate(token.id);
          }}
        >
          Revoke
        </Button>
      )}
    </li>
  );
}
