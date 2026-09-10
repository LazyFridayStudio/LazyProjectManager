import { useState } from 'react';

import { Button, useModalDialog } from '../ui/index.js';
import styles from './ProjectSettingsScreen.module.css';

/**
 * The instructions, on the screen that needs them.
 *
 * Connecting a repository is half a dozen steps on somebody else's website, and
 * the settings screen only ever showed the fields — which is the half a person
 * already has in front of them. The half they do not have is where the numbers
 * come from and which of the two connections does what.
 *
 * Kept behind a button rather than printed above the form: it is read once per
 * repository and never again, and a panel that explains itself at length every
 * time is a panel people stop reading.
 */
export function RepositorySetupHelp(): React.JSX.Element {
  const [showing, setShowing] = useState(false);

  return (
    <>
      <button
        type="button"
        className={styles.helpButton}
        onClick={() => {
          setShowing(true);
        }}
      >
        How to set this up
      </button>

      {showing && (
        <SetupDialog
          onDone={() => {
            setShowing(false);
          }}
        />
      )}
    </>
  );
}

function SetupDialog({ onDone }: { onDone: () => void }): React.JSX.Element {
  const dialog = useModalDialog(onDone);

  return (
    <dialog
      {...dialog.dialogProps}
      className={styles.helpDialog}
      aria-label="Connecting a repository"
    >
      <div className={styles.helpBody}>
        <h2 className={styles.helpHeading}>Connecting a repository</h2>

        <p className={styles.message}>
          Two connections, and they do different things. The webhook is how a repository tells this
          project what just happened; the GitHub App is how this project asks the repository what it
          has. The first puts commits on cards. The second fills the Builds page, and is optional.
        </p>

        <TheWebhook />
        <TheApp />

        <div className={styles.helpActions}>
          <Button onClick={dialog.close}>Close</Button>
        </div>
      </div>
    </dialog>
  );
}

/** What every connection needs, whichever forge it is. */
function TheWebhook(): React.JSX.Element {
  return (
    <section className={styles.helpPart}>
      <h3 className={styles.helpPartHeading}>The webhook — commits on cards</h3>

      <ol className={styles.helpSteps}>
        <li>
          Fill in the repository as <span className={styles.key}>owner/name</span> above and press
          Connect. An address and a secret appear, and the secret is shown only that once.
        </li>
        <li>
          On the repository: Settings → Webhooks → <strong>Add webhook</strong>.
        </li>
        <li>
          Paste the address into <strong>Payload URL</strong> and the secret into{' '}
          <strong>Secret</strong>.
        </li>
        <li>
          Set <strong>Content type</strong> to <span className={styles.key}>application/json</span>.
          The box defaults to a form-encoded payload, which is read as well — a webhook left alone
          still arrives — but JSON is the plainer of the two and the shape everything else here
          speaks.
        </li>
        <li>
          Choose <strong>Let me select individual events</strong>, then tick Pushes and Pull
          requests.
        </li>
        <li>
          Push a commit whose message names a card, like <span className={styles.key}>NWD-14</span>.
          It shows on that card within a few seconds.
        </li>
      </ol>

      <p className={styles.message}>
        The count against Deliveries above is how you know it is arriving. Nothing is ever pushed
        back to the repository.
      </p>
    </section>
  );
}

/** The half that only GitHub can do, and only for the Builds page. */
function TheApp(): React.JSX.Element {
  return (
    <section className={styles.helpPart}>
      <h3 className={styles.helpPartHeading}>The GitHub App — releases, and issues as cards</h3>

      <ol className={styles.helpSteps}>
        <li>
          Create an App at <span className={styles.key}>github.com/settings/apps/new</span>. Untick
          the webhook&apos;s Active box, then set two Repository permissions:{' '}
          <strong>Contents</strong> to <strong>Read-only</strong>, which is where releases live, and{' '}
          <strong>Issues</strong> to <strong>Read and write</strong> — read to put them on the
          board, write to label them with the list they are on. Those are the only two.
        </li>
        <li>
          The <strong>App ID</strong> is on the App&apos;s General tab.
        </li>
        <li>
          Further down that page, Generate a private key. A <span className={styles.key}>.pem</span>{' '}
          file downloads.
        </li>
        <li>
          Install App → Only select repositories → this one. The number at the end of the address
          you land on is the <strong>Installation ID</strong>:
          <p className={styles.helpExample}>
            https://github.com/settings/installations/<strong>12345678</strong>
          </p>
        </li>
        <li>
          Paste all three below and press Check and save. They are checked before they are kept.
        </li>
        <li>
          Open the project&apos;s Builds page and press the sync arrow beside the title for the
          releases, and the board for the issues. It is the same button on both.
        </li>
      </ol>

      <p className={styles.message}>
        Issues and cards stay in step both ways: an issue arrives as a card, a card written after
        you connect is raised as an issue, and where the two disagree the side that changed last
        wins. Where a card sits is always the board&apos;s to say — the list becomes a label, and
        the last list closes the issue. Cards already on the board when you connected are left
        alone. The worker does the same reconcile every half hour, so the button is only for when
        you want it now. A repository on Gitea or GitLab keeps its commits and skips this half.
      </p>
    </section>
  );
}
