import type { ScmProvider } from '@lpm/shared';

/**
 * Whether a delivery means the board may be behind the forge.
 *
 * Separate from `readDelivery`, which answers a different question: that one
 * says which cards a delivery *names*, and this says whether the issue list it
 * came from has moved. A merge names cards and changes state; a comment names
 * cards and changes nothing.
 *
 * **It does not say what changed, and deliberately so.** Acting on the payload
 * would put a second answer to "where does this card go" beside the sync's, and
 * the two would spend every half hour disagreeing — the same trap `closed_at`
 * was heading for before the list became the only thing that finishes a card.
 * All this does is bring the next reconcile forward from half an hour to now,
 * and `syncProjectIssues` still decides everything.
 *
 * Read defensively, like everything else here: this is somebody else's JSON,
 * three providers spell it differently, and a field that is missing means "not
 * that" rather than an exception that stops the batch.
 */
export function deliveryWantsASync(
  provider: ScmProvider,
  eventName: string,
  payload: unknown,
): boolean {
  return isIssueEvent(provider, eventName) || isSettledPullRequest(provider, eventName, payload);
}

/**
 * An issue opened, closed, reopened, retitled or relabelled.
 *
 * Every one of those is a thing the board mirrors, and none of them was read
 * before — `readDelivery` handles `push` and `pull_request` and returns nothing
 * for the rest, so closing an issue reached the board only on the clock.
 */
function isIssueEvent(provider: ScmProvider, eventName: string): boolean {
  return provider === 'gitlab' ? eventName === 'Issue Hook' : eventName === 'issues';
}

/**
 * A pull request that has just closed, which is how an issue usually closes.
 *
 * `Closes #255` in a squashed merge closes the issue on the forge, and the
 * `issues` delivery for that follows — but not always, and not always first.
 * Taking both means the board is caught up by whichever arrives, and reading
 * the same delivery twice costs one extra reconcile rather than a wrong one.
 */
function isSettledPullRequest(provider: ScmProvider, eventName: string, payload: unknown): boolean {
  if (provider === 'gitlab' ? eventName !== 'Merge Request Hook' : eventName !== 'pull_request') {
    return false;
  }

  const body = asRecord(payload);
  const action = asString(body?.action) ?? asString(asRecord(body?.object_attributes)?.action);

  return action === 'closed' || action === 'merge' || action === 'reopen';
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
