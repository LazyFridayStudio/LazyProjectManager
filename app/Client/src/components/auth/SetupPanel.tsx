import { MINIMUM_PASSWORD_LENGTH } from '@lpm/shared';
import { useState, type ChangeEvent } from 'react';

import { ApiFailureError } from '../../api/index.js';
import { Button, Field, Panel } from '../ui/index.js';
import styles from './AuthScreen.module.css';
import { useCompleteSetup } from '../../logic/auth/use-identity.js';

interface SetupForm {
  serverName: string;
  displayName: string;
  email: string;
  password: string;
}

const EMPTY_FORM: SetupForm = { serverName: '', displayName: '', email: '', password: '' };

/**
 * The first-run wizard, shown when a reachable server reports it has never been
 * set up.
 *
 * Whoever reaches an un-set-up install first becomes its owner. That is the
 * standard self-hosted trade: the alternative is a bootstrap token in the
 * container logs, which a studio installing this on their own box would have to
 * go hunting for. The window closes the moment this form is submitted, and the
 * database refuses a second attempt.
 */
export function SetupPanel({ serverUrl }: { serverUrl: string }): React.JSX.Element {
  return (
    <Panel floating>
      <h1 className={styles.heading}>Set up this server</h1>
      <p className={styles.explanation}>
        Nobody has claimed this install yet. The account you create here owns it.
      </p>
      <SetupForm serverUrl={serverUrl} />
    </Panel>
  );
}

function SetupForm({ serverUrl }: { serverUrl: string }): React.JSX.Element {
  const [form, setForm] = useState<SetupForm>(EMPTY_FORM);
  const completeSetup = useCompleteSetup();
  const problems = readFieldProblems(completeSetup.error);

  const update =
    (field: keyof SetupForm) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      const { value } = event.target;
      setForm((current) => ({ ...current, [field]: value }));
    };

  const submit = (): void => {
    completeSetup.mutate({
      serverName: form.serverName,
      baseUrl: serverUrl,
      admin: { email: form.email, password: form.password, displayName: form.displayName },
    });
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className={styles.form}
    >
      <Field
        label="Studio name"
        autoFocus
        placeholder="Example Studio"
        value={form.serverName}
        onChange={update('serverName')}
        problem={problems.serverName}
      />
      <Field
        label="Your name"
        autoComplete="name"
        placeholder="Alex Taylor"
        value={form.displayName}
        onChange={update('displayName')}
        problem={problems['admin.displayName']}
      />
      <Field
        label="Work email"
        type="email"
        autoComplete="username"
        placeholder="name@example.com"
        value={form.email}
        onChange={update('email')}
        problem={problems['admin.email']}
      />
      <Field
        label="Password"
        type="password"
        autoComplete="new-password"
        placeholder="••••••••••••"
        value={form.password}
        onChange={update('password')}
        hint={`At least ${String(MINIMUM_PASSWORD_LENGTH)} characters. A phrase beats a puzzle.`}
        problem={problems['admin.password']}
      />

      {completeSetup.isError && Object.keys(problems).length === 0 && (
        <p className={styles.formProblem}>{describeSetupFailure(completeSetup.error)}</p>
      )}

      <Button tone="go" type="submit" busy={completeSetup.isPending} busyLabel="Setting up…">
        Create owner account
      </Button>
    </form>
  );
}

/**
 * Field-level messages the server sent back, keyed by the dotted input path, so
 * each one can be shown against the control it belongs to.
 */
function readFieldProblems(error: Error | null): Readonly<Record<string, string>> {
  if (error instanceof ApiFailureError && error.fields !== undefined) {
    return error.fields;
  }

  return {};
}

function describeSetupFailure(error: Error): string {
  if (error instanceof ApiFailureError) {
    return error.message;
  }

  return 'Could not reach the server. Check your connection and try again.';
}
