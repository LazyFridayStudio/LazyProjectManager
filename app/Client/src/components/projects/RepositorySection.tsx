import { SCM_PROVIDERS, describeScmProvider, type ScmProvider } from '@lpm/shared';
import { useState } from 'react';

import { copyText } from '../../lib/copy-text.js';
import { Button, Field, Loading, Select } from '../ui/index.js';
import { formatTimeAgo } from '../../logic/projects/format-project-values.js';
import { RepositoryAccessSection } from './RepositoryAccessSection.js';
import {
  generateWebhookSecret,
  useConnectScm,
  useDisconnectScm,
  useScmConnection,
} from '../../logic/projects/use-scm.js';
import styles from './ProjectSettingsScreen.module.css';

const PROVIDER_OPTIONS = SCM_PROVIDERS.map((provider) => ({
  value: provider,
  label: describeScmProvider(provider),
}));

/**
 * Where this project's work lands, and whether anything is coming back.
 *
 * Read-only by design: nothing here pushes, merges or closes anything. It is a
 * repository saying what happened, which is the only half of the integration
 * that cannot go wrong in somebody else's codebase.
 */
export function RepositorySection({ projectId }: { projectId: string }): React.JSX.Element {
  const connection = useScmConnection(projectId);
  const disconnect = useDisconnectScm(projectId);
  /**
   * The secret just made, held here rather than in the form that made it.
   *
   * Connecting invalidates the connection query, and the refetch swaps this
   * screen to the connected view — which unmounted the form before it could
   * show anything. The secret was generated, encrypted, stored, and shown to
   * nobody, which made the webhook impossible to sign. It has to be held above
   * the thing that goes away.
   */
  const [justMade, setJustMade] = useState<string | null>(null);

  if (connection.isPending) {
    return <Loading what="Loading the connection" />;
  }

  if (justMade !== null) {
    return (
      <SecretShownOnce
        secret={justMade}
        // The address comes from the connection that was just made, which the
        // refetch has by now. Both are needed in one place: they are pasted
        // into the same form on the other side, and the secret cannot be
        // fetched again to pair with it later.
        webhookUrl={connection.data?.connection?.webhookUrl ?? null}
        onDone={() => {
          setJustMade(null);
        }}
      />
    );
  }

  if (connection.data?.connection == null) {
    return <ConnectForm projectId={projectId} onConnected={setJustMade} />;
  }

  const { connection: repository } = connection.data;

  return (
    <>
      <ul className={styles.rows}>
        <li className={styles.row}>
          <span>{repository.repoFullName}</span>
          <span className={styles.rowMeta}>{describeScmProvider(repository.provider)}</span>
        </li>
        <li className={styles.row}>
          <span>Deliveries</span>
          <span className={styles.rowMeta}>
            {repository.eventsReceived === 0
              ? 'none yet'
              : `${String(repository.eventsReceived)}, last ${formatTimeAgo(repository.lastEventAt ?? repository.connectedAt)}`}
          </span>
        </li>
      </ul>

      <WebhookAddress url={repository.webhookUrl} />

      {repository.eventsReceived === 0 && (
        <p className={styles.message}>
          Nothing has arrived yet. Add the address above as a webhook on the repository, then push
          something.
        </p>
      )}

      <div className={styles.actions}>
        <Button
          tone="stop"
          onClick={() => {
            disconnect.mutate();
          }}
          busy={disconnect.isPending}
          busyLabel="Disconnecting…"
        >
          Disconnect
        </Button>
      </div>

      {/* Only once there is a repository: credentials extend a connection
          rather than making one. */}
      <h2>Reading releases</h2>
      <RepositoryAccessSection projectId={projectId} connection={repository} />
    </>
  );
}

/**
 * Connecting a repository, and the one moment its secret is visible.
 *
 * The secret is made here and shown once. It is never sent back by the server —
 * a settings screen that could show it again would be a way to read it out of
 * any project somebody can open — so if it is lost, connecting again makes a new
 * one and stops the old one working.
 */
function ConnectForm({
  projectId,
  onConnected,
}: {
  projectId: string;
  onConnected: (secret: string) => void;
}): React.JSX.Element {
  const connect = useConnectScm(projectId);
  const [provider, setProvider] = useState<ScmProvider>('github');
  const [repoFullName, setRepoFullName] = useState('');
  const [endpoint, setEndpoint] = useState('');

  const submit = (): void => {
    const webhookSecret = generateWebhookSecret();

    connect.mutate(
      {
        projectId,
        provider,
        repoFullName: repoFullName.trim(),
        endpoint: endpoint.trim() === '' ? null : endpoint.trim(),
        webhookSecret,
      },
      {
        // Handed up rather than held here: this form is about to be unmounted
        // by the refetch that follows, and a secret shown by a component that
        // no longer exists is a secret nobody ever sees.
        onSuccess: () => {
          onConnected(webhookSecret);
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
        Commits and branches that name a card key will show on that card. Nothing is pushed back.
      </p>

      <Select
        label="Provider"
        options={PROVIDER_OPTIONS}
        value={provider}
        onChange={(event) => {
          setProvider(event.target.value as ScmProvider);
        }}
      />

      <Field
        label="Repository"
        placeholder="owner/repository"
        value={repoFullName}
        onChange={(event) => {
          setRepoFullName(event.target.value);
        }}
      />

      {/* Shown for GitHub too, because an Enterprise install is a GitHub at
          somebody else's address — and because it is how a developer points a
          project at the fake forge instead of the real one. */}
      <Field
        label="Server address"
        type="url"
        placeholder={
          provider === 'github' ? 'https://github.example.com' : 'https://git.example.com'
        }
        hint={
          provider === 'github'
            ? 'Leave empty for github.com. Set it for an Enterprise install.'
            : "The forge's own address, when it is not the provider's."
        }
        value={endpoint}
        onChange={(event) => {
          setEndpoint(event.target.value);
        }}
      />

      <div className={styles.actions}>
        <Button
          tone="go"
          type="submit"
          busy={connect.isPending}
          busyLabel="Connecting…"
          disabled={repoFullName.trim() === ''}
        >
          Connect
        </Button>
      </div>
    </form>
  );
}

function SecretShownOnce({
  secret,
  webhookUrl,
  onDone,
}: {
  secret: string;
  webhookUrl: string | null;
  onDone: () => void;
}): React.JSX.Element {
  return (
    <>
      <p className={styles.message}>
        Connected. Add a webhook on the repository with the address and secret below — this is the
        only time the secret is shown. Nothing here can show it again; connecting once more makes a
        new one and stops the old one working.
      </p>
      {webhookUrl !== null && <Copyable label="Webhook address" value={webhookUrl} />}
      <Copyable label="Secret" value={secret} />

      <div className={styles.actions}>
        {/* Dismissed deliberately, so the one moment it is visible does not end
            because something else on the screen finished loading. */}
        <Button onClick={onDone}>I have saved it</Button>
      </div>
    </>
  );
}

function WebhookAddress({ url }: { url: string }): React.JSX.Element {
  return <Copyable label="Webhook address" value={url} />;
}

/**
 * A value to be pasted somewhere else, with a button that does the pasting part.
 *
 * Read-only rather than plain text: a URL and a secret are both long enough that
 * selecting them by hand is where the mistake happens.
 */
function Copyable({ label, value }: { label: string; value: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  return (
    <div className={styles.copyable}>
      <Field
        label={label}
        readOnly
        value={value}
        onFocus={(event) => {
          event.target.select();
        }}
      />
      <Button
        onClick={() => {
          void (async () => {
            // Says whether it worked rather than assuming: without HTTPS the
            // modern clipboard is not there at all, and this is the screen
            // where a secret is shown exactly once.
            setCopied(await copyText(value));
          })();
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
