import type { HealthView } from '@lpm/shared';
import { useState } from 'react';

import { ApiFailureError } from '../../api/index.js';
import { BrandMark, Button, Field, Panel } from '../ui/index.js';
import styles from './AuthScreen.module.css';
import { useSignIn } from '../../logic/auth/use-identity.js';

interface SignInPanelProps {
  readonly health: HealthView;
  readonly serverUrl: string;
  readonly onChangeServer: () => void;
}

/**
 * Step two of the prototype's login flow.
 *
 * Single sign-on is drawn in the prototype but is an explicit non-goal for v1
 * (`README.md`), and `ARCHITECTURE.md` specifies no third-party identity
 * provider, so the divider and provider rows are deliberately absent rather than
 * present and inert.
 */
export function SignInPanel({
  health,
  serverUrl,
  onChangeServer,
}: SignInPanelProps): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const signIn = useSignIn();

  const submit = (): void => {
    signIn.mutate({ email, password });
  };

  return (
    <Panel floating>
      <div className={styles.brand}>
        {/* The studio's logo slot. It draws the product's mark until a studio
            has a way to put their own here. */}
        <BrandMark size={34} />
        <span className={styles.brandText}>
          <span className={styles.brandName}>{health.serverName}</span>
          <span className={styles.serverChip}>{serverUrl}</span>
        </span>
        <button type="button" className={styles.changeServer} onClick={onChangeServer}>
          Change
        </button>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className={styles.form}
      >
        <Field
          label="Work email"
          type="email"
          autoComplete="username"
          autoFocus
          placeholder="name@example.com"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••••••"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />

        {signIn.isError && (
          <p className={styles.formProblem}>{describeSignInFailure(signIn.error)}</p>
        )}

        <Button tone="go" type="submit" busy={signIn.isPending} busyLabel="Signing in…">
          Sign in
        </Button>
      </form>
    </Panel>
  );
}

/**
 * The server's own message is shown for a failure it described, because it is
 * deliberately vague — "that email or password is not right" rather than saying
 * which, so the screen cannot be used to discover who has an account here.
 */
function describeSignInFailure(error: Error): string {
  if (error instanceof ApiFailureError) {
    return error.message;
  }

  return 'Could not reach the server. Check your connection and try again.';
}
