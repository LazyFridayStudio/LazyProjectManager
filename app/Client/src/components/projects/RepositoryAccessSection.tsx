import type { ScmConnection } from '@lpm/shared';
import { useState, type ChangeEvent } from 'react';

import { readFieldProblems } from '../../api/failure-messages.js';
import { Button, Field } from '../ui/index.js';
import { formatTimeAgo } from '../../logic/projects/format-project-values.js';
import { useConnectScmApp, useDisconnectScmApp } from '../../logic/projects/use-scm.js';
import styles from './ProjectSettingsScreen.module.css';

/**
 * Credentials for asking the repository things, not only hearing from it.
 *
 * A webhook is one-way. It says a push happened, which is enough for commits,
 * branches and pull requests — and no use for releases and builds, which are a
 * list the forge holds until somebody asks for it. A GitHub App signs for a
 * short-lived token that can.
 *
 * Optional, and separate from connecting the repository, because a project that
 * never opens the Builds page needs none of it and should not be asked for a
 * private key to get commits on a card.
 */
export function RepositoryAccessSection({
  projectId,
  connection,
}: {
  projectId: string;
  connection: ScmConnection;
}): React.JSX.Element {
  if (connection.provider !== 'github') {
    return (
      <p className={styles.message}>
        Reading releases and builds needs a GitHub App, and this project is connected to{' '}
        {connection.provider}. Commits, branches and pull requests still arrive by webhook.
      </p>
    );
  }

  return connection.appAccess === null ? (
    <ConnectAppForm projectId={projectId} />
  ) : (
    <>
      <ConnectedApp projectId={projectId} access={connection.appAccess} />
      <WhyTheSyncIsFailing failure={connection.lastSyncFailure} />
    </>
  );
}

/**
 * Why the board is not filling itself, in the place somebody has come to fix it.
 *
 * The board's header can only say that a sync is failing and since when — it is
 * a row of facts in a monospace face, and this is a sentence. Said here because
 * this is the screen the answer is acted on: the credentials, the app, and the
 * repository it is installed on are all a few lines above.
 *
 * Nothing at all when the sync is working, which is the ordinary case. A panel
 * that permanently says "no problems" is a panel people stop reading.
 */
function WhyTheSyncIsFailing({
  failure,
}: {
  failure: ScmConnection['lastSyncFailure'];
}): React.JSX.Element | null {
  if (failure === null) {
    return null;
  }

  return (
    <p className={styles.problem} role="alert">
      {`Syncing issues has been failing since ${formatTimeAgo(failure.at)}: ${failure.reason}`}
    </p>
  );
}

function ConnectedApp({
  projectId,
  access,
}: {
  projectId: string;
  access: NonNullable<ScmConnection['appAccess']>;
}): React.JSX.Element {
  const disconnect = useDisconnectScmApp(projectId);

  return (
    <>
      <ul className={styles.rows}>
        <li className={styles.row}>
          <span>App</span>
          <span className={styles.rowMeta}>{access.appId}</span>
        </li>
        <li className={styles.row}>
          <span>Installation</span>
          <span className={styles.rowMeta}>{access.installationId}</span>
        </li>
        <li className={styles.row}>
          <span>Last checked</span>
          <span className={styles.rowMeta}>
            {access.checkedAt === null ? 'never' : formatTimeAgo(access.checkedAt)}
          </span>
        </li>
      </ul>

      <div className={styles.actions}>
        {/* Words rather than the bin. Nothing asks before this one: it
            disconnects the repository straight from the click, so its label is
            the only warning there is, and a bare mark would put a press between
            a project and its repository with nothing said in between.

            That it does not ask is worth fixing on its own —
            `Engineering-Rules.md` says a delete that loses something asks
            first. Until it does, the words stay. */}
        <Button
          tone="stop"
          busy={disconnect.isPending}
          busyLabel="Removing…"
          onClick={() => {
            disconnect.mutate(undefined, {});
          }}
        >
          Remove credentials
        </Button>
      </div>
    </>
  );
}

/**
 * Asking for the three things a GitHub App is.
 *
 * Checked against the forge before anything is stored, so a wrong key is a
 * message on this form rather than a card that quietly stops showing commits a
 * fortnight from now.
 */
function ConnectAppForm({ projectId }: { projectId: string }): React.JSX.Element {
  const [appId, setAppId] = useState('');
  const [installationId, setInstallationId] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const connect = useConnectScmApp(projectId);
  const problems = readFieldProblems(connect.error);

  const submit = (): void => {
    connect.mutate(
      { projectId, appId: appId.trim(), installationId: installationId.trim(), privateKey },
      {
        onSuccess: () => {
          // Not kept a moment longer than the request needs it.
          setPrivateKey('');
        },
      },
    );
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className={styles.message}>
        Only needed for the Builds page, which reads releases from the repository. Register a GitHub
        App with read access to contents, install it on this repository, then paste what it gives
        you.
      </p>

      <Field
        label="App ID"
        placeholder="412345"
        value={appId}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setAppId(event.target.value);
        }}
        problem={problems.appId}
      />

      <Field
        label="Installation ID"
        placeholder="98765"
        hint="The number at the end of the installation's settings URL."
        value={installationId}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setInstallationId(event.target.value);
        }}
        problem={problems.installationId}
      />

      <label className={styles.keyField}>
        <span className={styles.keyLabel}>Private key</span>
        <textarea
          className={styles.keyInput}
          placeholder="-----BEGIN RSA PRIVATE KEY-----"
          rows={5}
          value={privateKey}
          onChange={(event) => {
            setPrivateKey(event.target.value);
          }}
        />
        <span className={styles.keyHint}>
          Stored encrypted and never shown again. Pasting a new one replaces it.
        </span>
      </label>

      <div className={styles.actions}>
        <Button
          tone="go"
          type="submit"
          busy={connect.isPending}
          busyLabel="Checking…"
          disabled={appId.trim() === '' || installationId.trim() === '' || privateKey.trim() === ''}
        >
          Check and save
        </Button>
      </div>
    </form>
  );
}
