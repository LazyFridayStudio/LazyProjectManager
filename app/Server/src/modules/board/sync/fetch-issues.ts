import type { RepositoryReader } from '../../scm/forge/read-repository.js';
import { askForge } from './forge-request.js';
import { readForgeIssues, type ForgeIssue } from './read-forge-issues.js';

/**
 * How many issues to read.
 *
 * A hundred is a page of GitHub's own default and more than most studios have
 * open at once. Beyond that a board fills with cards nobody asked for, and the
 * ones that matter are the recent ones either way.
 */
const MOST_ISSUES = 100;

const PER_PAGE = 100;

/** What a sync needs to know before it asks. */
export interface IssueRequest {
  /** When the board last reconciled, so a closed issue since then can be asked for. */
  readonly syncedAt: Date | null;
  /** Whether the project has asked to be spared its repository's closed history. */
  readonly openOnly: boolean;
  /** Whether any card here already stands for an issue. */
  readonly hasLinkedCards: boolean;
}

/**
 * Reads the repository's issues.
 *
 * `state=all` is the default and the reason is good: a card that has to move to
 * Done needs its issue to still be in the answer, and asking for open issues
 * alone would mean an issue closing simply vanished — which reads as a card
 * that was never there rather than one that is finished.
 *
 * One page, because paging until a studio's whole history is in would be a
 * button press that takes a minute and fills a board nobody scrolls.
 *
 * **With `openOnly` it is two requests instead.** The first asks for open
 * issues, so the hundred is spent on work that is still to do rather than on a
 * repository's closed history — which on anything with a past is most of it,
 * and is what leaves an open issue older than the last hundred created never
 * arriving at all. The second asks only for what has closed since the board
 * last looked, which is what keeps a linked card settling: without it the
 * setting would strand every card whose issue closed while it was on.
 *
 * The second is skipped when there is nothing linked to settle — a repository
 * connected a moment ago, where the answer could only be history nobody asked
 * for. It is skipped when the board has never reconciled for the same reason:
 * `since` would be unbounded and the request would fetch the very history the
 * setting exists to leave behind.
 */
export async function fetchForgeIssues(
  reader: RepositoryReader,
  request: IssueRequest = { syncedAt: null, openOnly: false, hasLinkedCards: false },
): Promise<ForgeIssue[]> {
  if (!request.openOnly) {
    return readPage(reader, `state=all&per_page=${String(PER_PAGE)}&sort=created&direction=desc`);
  }

  const open = await readPage(
    reader,
    `state=open&per_page=${String(PER_PAGE)}&sort=created&direction=desc`,
  );

  if (request.syncedAt === null || !request.hasLinkedCards) {
    return open;
  }

  /*
   * Everything that has closed since the board last looked.
   *
   * `since` is the forge's own filter on when an issue last changed, so this is
   * a small answer that gets smaller the more often the sync runs — and a
   * delivery now makes it run promptly rather than on the half hour.
   */
  const closed = await readPage(
    reader,
    `state=closed&since=${request.syncedAt.toISOString()}&per_page=${String(PER_PAGE)}`,
  );

  return [...open, ...closed].slice(0, MOST_ISSUES);
}

async function readPage(reader: RepositoryReader, search: string): Promise<ForgeIssue[]> {
  const response = await askForge(reader, {
    method: 'GET',
    path: `/issues?${search}`,
    attempting: 'read',
  });

  return readForgeIssues(await response.json()).slice(0, MOST_ISSUES);
}
