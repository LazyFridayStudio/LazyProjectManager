import { useApiClient } from '../ApiClientProvider.js';
import styles from './AgentsSection.module.css';

/**
 * Where to point something, and how it says who it is.
 *
 * The other half of the errand this screen exists for. Making an agent and
 * giving it a key is useless without the address, and an address somebody has
 * to work out from the browser bar is one they will get wrong behind a tunnel —
 * which is exactly where a self-hosted install usually is.
 *
 * What it says is true today: the command and query surface is the one the app
 * itself uses, and a key reaches it the same way a session does. The MCP
 * command joins this panel when the server it names exists.
 */
export function ConnectingAClient(): React.JSX.Element {
  const { baseUrl } = useApiClient();

  return (
    <section className={styles.panel} aria-label="Connecting a client">
      <h2 className={styles.heading}>Connecting a client</h2>

      <p className={styles.about}>
        An agent reaches this install at the address below, presenting its key as a bearer token. It
        is the same surface the app itself uses, so an agent can do anything a person with the same
        permissions could.
      </p>

      <dl className={styles.facts}>
        <dt className={styles.factLabel}>This install</dt>
        <dd className={styles.factValue}>{baseUrl === '' ? window.location.origin : baseUrl}</dd>

        <dt className={styles.factLabel}>Saying who it is</dt>
        <dd className={styles.factValue}>Authorization: Bearer lpm_…</dd>

        <dt className={styles.factLabel}>Doing something</dt>
        <dd className={styles.factValue}>POST /api/c/&lt;command&gt;</dd>

        <dt className={styles.factLabel}>Asking something</dt>
        <dd className={styles.factValue}>GET /api/q/&lt;query&gt;</dd>
      </dl>

      <p className={styles.about}>
        <strong>docs/Asking-Claude.md</strong> is the page to hand an assistant: the two endpoints,
        what a refusal means, and a worked example of sorting a board into legends.
      </p>

      <p className={styles.about}>
        A key is not a way past anything. An agent is refused exactly what a person holding the same
        permission groups would be refused, and everything it does is in the audit trail under its
        own name.
      </p>
    </section>
  );
}
