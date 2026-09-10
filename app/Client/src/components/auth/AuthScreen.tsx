import { useState } from 'react';

import { useApiClient } from '../ApiClientProvider.js';
import { ApiUnreachableError } from '../../api/index.js';
import styles from './AuthScreen.module.css';
import { ConnectToServerPanel } from './ConnectToServerPanel.js';
import { Backdrop } from '../shell/Backdrop.js';
import { rememberRecentServer } from '../../logic/auth/recent-servers.js';
import { SetupPanel } from './SetupPanel.js';
import { SignInPanel } from './SignInPanel.js';
import { useServerHealth } from '../../logic/auth/use-identity.js';

/**
 * The signed-out screen: connect to a server, then sign in or set it up.
 *
 * The prototype models these as steps within one screen rather than as separate
 * pages, and so does this — there is no URL worth bookmarking mid-sign-in, and a
 * route would put the animated backdrop through a remount on every step.
 */
export function AuthScreen(): React.JSX.Element {
  const { baseUrl, connectTo } = useApiClient();
  const health = useServerHealth();
  // Set when the user asks to change server, so a reachable server can still be
  // swapped for a different one.
  const [isChoosingServer, setIsChoosingServer] = useState(false);

  const connect = (nextBaseUrl: string): void => {
    rememberRecentServer(nextBaseUrl);
    connectTo(nextBaseUrl);
    setIsChoosingServer(false);
  };

  return (
    <div className={styles.screen}>
      <Backdrop mood="sign-in" />
      <div className={styles.stack}>
        {renderStep({
          health: health.data,
          isChecking: health.isFetching,
          problem: health.isError ? describeProbeFailure(health.error, baseUrl) : undefined,
          baseUrl,
          isChoosingServer,
          onConnect: connect,
          onChangeServer: () => {
            setIsChoosingServer(true);
          },
        })}
      </div>
    </div>
  );
}

interface StepOptions {
  readonly health: ReturnType<typeof useServerHealth>['data'];
  readonly isChecking: boolean;
  readonly problem: string | undefined;
  readonly baseUrl: string;
  readonly isChoosingServer: boolean;
  readonly onConnect: (baseUrl: string) => void;
  readonly onChangeServer: () => void;
}

/**
 * A server that answers goes straight to sign-in. Typing an address is only
 * needed when the current one is not a LazyProjectManager install — a desktop
 * client, or a typo — which is why the connect step is not the default.
 */
function renderStep(options: StepOptions): React.JSX.Element {
  const isServerUnusable = options.health === undefined;

  if (options.isChoosingServer || isServerUnusable) {
    return (
      <ConnectToServerPanel
        currentBaseUrl={options.baseUrl}
        health={options.health}
        isChecking={options.isChecking}
        problem={options.problem}
        onConnect={options.onConnect}
      />
    );
  }

  if (!options.health.setupCompleted) {
    return <SetupPanel serverUrl={options.baseUrl} />;
  }

  return (
    <SignInPanel
      health={options.health}
      serverUrl={options.baseUrl}
      onChangeServer={options.onChangeServer}
    />
  );
}

function describeProbeFailure(error: Error, baseUrl: string): string {
  if (error instanceof ApiUnreachableError) {
    return `Nothing answered at ${baseUrl}.`;
  }

  return 'That address answered, but not like a LazyProjectManager server.';
}
