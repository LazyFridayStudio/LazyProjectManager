import type { RepositoryReader } from '../../scm/forge/read-repository.js';
import { askForge } from './forge-request.js';

/**
 * Raising and changing issues, which is the board talking rather than listening.
 *
 * Narrow on purpose. Three things happen here — an issue is raised for a card
 * that has none, an issue's title and body are brought into line with its card,
 * and an issue is closed or reopened to match where its card sits. Nothing else
 * about an issue is ever written.
 */

export interface IssueToRaise {
  readonly cardId: string;
  readonly title: string;
  readonly body: string | null;
}

/** What the forge gave the issue it just made. */
export interface RaisedIssue {
  readonly cardId: string;
  readonly externalId: string;
  readonly ref: string;
  readonly url: string | null;
}

/**
 * Raises an issue for a card that does not have one.
 *
 * The card's own words: whoever wrote the card wrote the issue, and a body that
 * said "raised from LazyProjectManager" would be a line nobody needs on every
 * issue a studio has.
 */
export async function raiseIssue(
  reader: RepositoryReader,
  card: IssueToRaise,
): Promise<RaisedIssue | null> {
  const response = await askForge(reader, {
    method: 'POST',
    path: '/issues',
    body: { title: card.title, ...(card.body === null ? {} : { body: card.body }) },
    attempting: 'write',
  });

  const made: unknown = await response.json();

  if (typeof made !== 'object' || made === null) {
    return null;
  }

  const {
    id,
    number,
    html_url: url,
  } = made as {
    id?: unknown;
    number?: unknown;
    html_url?: unknown;
  };

  // Without an id there is nothing to match on next time, which would mean
  // raising it again on the next sync. Better to leave the card unlinked and
  // say nothing than to lose track of an issue that now exists.
  if (typeof id !== 'number' || typeof number !== 'number') {
    return null;
  }

  return {
    cardId: card.cardId,
    externalId: String(id),
    ref: String(number),
    url: typeof url === 'string' ? url : null,
  };
}

export interface IssueChange {
  readonly ref: string;
  readonly title?: string;
  readonly body?: string | null;
  /** `open` or `closed`, when the board and the issue disagree about it. */
  readonly state?: 'open' | 'closed';
}

/**
 * Brings an issue into line with its card.
 *
 * One request, because the forge takes all three fields at once and three
 * requests would be three chances for half of it to land.
 */
export async function changeIssue(reader: RepositoryReader, change: IssueChange): Promise<void> {
  const body: Record<string, unknown> = {};

  if (change.title !== undefined) {
    body.title = change.title;
  }

  if (change.body !== undefined) {
    body.body = change.body ?? '';
  }

  if (change.state !== undefined) {
    body.state = change.state;
  }

  if (Object.keys(body).length === 0) {
    return;
  }

  await askForge(reader, {
    method: 'PATCH',
    path: `/issues/${encodeURIComponent(change.ref)}`,
    body,
    attempting: 'write',
  });
}
