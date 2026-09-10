import type { HealthView } from '@lpm/shared';
import { useState } from 'react';

import { Button, Field, Panel } from '../ui/index.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import styles from './AuthScreen.module.css';
import { readRecentServers, type RecentServer } from '../../logic/auth/recent-servers.js';

interface ConnectToServerPanelProps {
  readonly currentBaseUrl: string;
  readonly health: HealthView | undefined;
  readonly isChecking: boolean;
  readonly problem: string | undefined;
  readonly onConnect: (baseUrl: string) => void;
}

/**
 * Step one of the prototype's login flow: choose which server to talk to.
 *
 * Shown only when the current address is not answering. An install reached at
 * its own URL skips straight past this to sign in, which is the common case —
 * typing an address is for a desktop client, or for fixing a typo.
 */
export function ConnectToServerPanel({
  currentBaseUrl,
  health,
  isChecking,
  problem,
  onConnect,
}: ConnectToServerPanelProps): React.JSX.Element {
  const [serverUrl, setServerUrl] = useState(currentBaseUrl);
  const recentServers = readRecentServers();

  const submit = (): void => {
    onConnect(serverUrl);
  };

  return (
    <Panel floating>
      <h1 className={styles.heading}>Connect to a server</h1>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className={styles.form}
      >
        <Field
          label="Server address"
          type="url"
          inputMode="url"
          autoFocus
          placeholder="https://pm.yourstudio.com"
          value={serverUrl}
          onChange={(event) => {
            setServerUrl(event.target.value);
          }}
        />

        <ServerStatus health={health} isChecking={isChecking} problem={problem} />

        <Button tone="go" type="submit" busy={isChecking} busyLabel="Checking…">
          Connect
        </Button>
      </form>

      {recentServers.length > 0 && (
        <ul className={styles.recentServers}>
          {recentServers.map((server) => (
            <li key={server.url}>
              <RecentServerButton server={server} onPick={onConnect} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RecentServerButton({
  server,
  onPick,
}: {
  server: RecentServer;
  onPick: (baseUrl: string) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={styles.recentServer}
      onClick={() => {
        onPick(server.url);
      }}
    >
      <span className={styles.monospace}>{server.url}</span>
      <span className={styles.recentServerNote}>{server.note}</span>
    </button>
  );
}

function ServerStatus({
  health,
  isChecking,
  problem,
}: {
  health: HealthView | undefined;
  isChecking: boolean;
  problem: string | undefined;
}): React.JSX.Element {
  const { dotClass, note } = describeServerStatus({ health, isChecking, problem });

  return (
    <p className={styles.status}>
      <span className={joinClassNames(styles.statusDot, dotClass)} aria-hidden />
      {/* Announced politely: the dot alone carries no meaning to a screen reader,
          and an assertive live region would interrupt typing in the URL field. */}
      <span role="status">{note}</span>
    </p>
  );
}

function describeServerStatus({
  health,
  isChecking,
  problem,
}: {
  health: HealthView | undefined;
  isChecking: boolean;
  problem: string | undefined;
  // `dotClass` is optional because CSS Module lookups are index accesses, and
  // `joinClassNames` drops anything absent rather than emitting "undefined".
}): { dotClass: string | undefined; note: string } {
  if (isChecking) {
    return { dotClass: styles.dotChecking, note: 'Checking…' };
  }

  if (problem !== undefined) {
    return { dotClass: styles.dotUnreachable, note: problem };
  }

  if (health === undefined) {
    return { dotClass: styles.dotChecking, note: 'Enter a server address.' };
  }

  if (health.status === 'degraded') {
    const unreachable = health.dependencies
      .filter((dependency) => !dependency.reachable)
      .map((dependency) => dependency.name);

    return {
      dotClass: styles.dotDegraded,
      note: `${health.serverName} is up but unhealthy (${unreachable.join(', ')}).`,
    };
  }

  return { dotClass: styles.dotReachable, note: `${health.serverName} · v${health.version}` };
}
