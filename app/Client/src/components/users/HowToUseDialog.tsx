import type { Agent } from '@lpm/shared';
import { useState } from 'react';

import { Button, useModalDialog } from '../ui/index.js';
import { useApiClient } from '../ApiClientProvider.js';
import styles from './HowToUseDialog.module.css';

/**
 * What to hand an assistant, with this install's own address already in it.
 *
 * The address is the part somebody gets wrong. Behind a tunnel it is not the
 * host in the browser bar and not `localhost`, and an assistant handed the
 * wrong one fails in a way that reads as a bad key. So the app says it, because
 * the app is the only thing that knows.
 *
 * A briefing rather than the whole guide. `docs/Asking-Claude.md` is the long
 * form and stays the long form — copying it in here would be a second copy to
 * drift, and this is the half somebody needs at the moment they have just made
 * a key and have it on the clipboard.
 */
export function HowToUseDialog({
  agent,
  onClose,
}: {
  readonly agent: Agent;
  readonly onClose: () => void;
}): React.JSX.Element {
  const dialog = useModalDialog(onClose);
  const { baseUrl } = useApiClient();
  const [copied, setCopied] = useState(false);

  const address = baseUrl === '' ? window.location.origin : baseUrl;
  const briefing = writeBriefing(agent.displayName, address);

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label="How to use">
      <div className={styles.body}>
        <h2 className={styles.heading}>Using {agent.displayName}</h2>

        <p className={styles.said}>
          Paste this to an assistant along with the agent&rsquo;s key. It has this install&rsquo;s
          address in it, which behind a tunnel is not the one in your browser bar.
        </p>

        <ol className={styles.first}>
          <li>
            Put {agent.displayName} on the projects it works on, from each project&rsquo;s Settings.
            Without that it sees no projects and gets no error saying so.
          </li>
          <li>Give it a permission group. It can read and take no action until you do.</li>
        </ol>

        <pre className={styles.briefing}>{briefing}</pre>

        <div className={styles.actions}>
          <Button
            tone="go"
            onClick={() => {
              void navigator.clipboard.writeText(briefing).then(
                () => {
                  setCopied(true);
                },
                () => {
                  // Refused, which some browsers do outside a secure context.
                  // The text is on screen and selectable, so there is nothing
                  // lost but the convenience.
                  setCopied(false);
                },
              );
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>

          <Button onClick={dialog.close}>Close</Button>
        </div>

        <p className={styles.more}>
          <code>docs/Asking-Claude.md</code> is the longer version, with a worked example of sorting
          a board into legends. <code>docs/Agents.md</code> covers setup and what to change in
          Cloudflare if a request comes back as a web page.
        </p>
      </div>
    </dialog>
  );
}

/**
 * The briefing itself.
 *
 * Written as prose an assistant reads rather than as a config block, because
 * what it needs is not only the address — it is knowing that a refusal is an
 * answer, that a `commandId` must be fresh, and that an HTML reply means
 * Cloudflare rather than a mistake it can fix by trying again.
 */
function writeBriefing(name: string, address: string): string {
  return [
    `You are ${name}, an agent on a LazyProjectManager install at ${address}.`,
    '',
    'Everything the app can do goes through two endpoints, and you reach both with',
    'the key you were given:',
    '',
    `  GET  ${address}/api/q/<query>    ask something, changes nothing`,
    `  POST ${address}/api/c/<command>  do something`,
    '',
    '  Authorization: Bearer lpm_…',
    '',
    'A query answers { ok, etag, data } — you want data. A command answers',
    '{ ok, id } and takes a commandId: a uuid you generate, a fresh one for every',
    'distinct action. Reusing one makes the second call a silent no-op.',
    '',
    'Start with:',
    `  GET ${address}/api/q/projects.list`,
    `  GET ${address}/api/q/board.view?slug=<the slug>`,
    '',
    'Every card on the board carries id, cardKey, title, type, isLegend and',
    'gathers. A legend is a card that contains others: board.setLegend makes one,',
    'and board.putUnderLegend puts a card under it by the legend’s key.',
    '',
    'Rules:',
    '  - Read before writing, and say the plan before changing anything.',
    '  - A refusal is an answer. 403 names the permission you lack; 404 means you',
    '    are not on that project. Ask for it rather than finding another route.',
    '  - If a reply is HTML or a redirect rather than JSON, Cloudflare answered',
    '    and not the app. Say so and stop — no retry will fix it.',
    '  - 429 means too fast. Wait, then carry on.',
  ].join('\n');
}
