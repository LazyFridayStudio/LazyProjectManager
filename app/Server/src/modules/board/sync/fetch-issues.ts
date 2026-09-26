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
 * Two pages, when there is anything to settle.
 *
 * **The first is the recent page**, one hundred issues newest first. `state=all`
 * by default, because a card that has to move to Done needs its issue to still be
 * in the answer. With `openOnly` it asks for open issues instead, so the hundred
 * is spent on work that is still to do rather than on a repository's closed
 * history — which on anything with a past is most of it.
 *
 * **The second is everything that changed since the board last looked.** The
 * recent page is ordered by when an issue was *made*, so an older issue is not in
 * it however recently it closed, and GitHub counts pull requests toward the
 * hundred as well. Without this page a card whose issue has slipped out of the
 * newest hundred never hears that it closed, reopened or was renamed: it sits
 * where it is, open, for good (#15). With `openOnly` it asks for closed issues
 * alone, so a reopened one still arrives through the open page and closed history
 * nobody linked is not asked for.
 *
 * Neither page is cut short to fit the other. Capping the pair at a hundred used
 * to drop the whole second page once a repository had a hundred open issues —
 * the very cards it exists to settle.
 *
 * The second page is skipped when there is nothing linked to settle — a
 * repository connected a moment ago, where the answer could only be history
 * nobody asked for. It is skipped when the board has never reconciled for the
 * same reason: `since` would be unbounded.
 */
export async function fetchForgeIssues(
  reader: RepositoryReader,
  request: IssueRequest = { syncedAt: null, openOnly: false, hasLinkedCards: false },
): Promise<ForgeIssue[]> {
  const recent = await readPage(
    reader,
    `state=${request.openOnly ? 'open' : 'all'}&per_page=${String(PER_PAGE)}&sort=created&direction=desc`,
  );

  if (request.syncedAt === null || !request.hasLinkedCards) {
    return recent;
  }

  /*
   * `since` is the forge's own filter on when an issue last changed, so this is
   * a small answer that gets smaller the more often the sync runs.
   */
  const changed = await readPage(
    reader,
    `state=${request.openOnly ? 'closed' : 'all'}&since=${request.syncedAt.toISOString()}` +
      `&per_page=${String(PER_PAGE)}&sort=updated&direction=desc`,
  );

  return withoutRepeats([...recent, ...changed]);
}

/**
 * Each issue once. An issue that is both recent and recently changed is on both
 * pages, and settling it twice would move its card twice.
 */
function withoutRepeats(issues: readonly ForgeIssue[]): ForgeIssue[] {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    if (seen.has(issue.externalId)) {
      return false;
    }

    seen.add(issue.externalId);

    return true;
  });
}

async function readPage(reader: RepositoryReader, search: string): Promise<ForgeIssue[]> {
  const response = await askForge(reader, {
    method: 'GET',
    path: `/issues?${search}`,
    attempting: 'read',
  });

  return readForgeIssues(await response.json()).slice(0, MOST_ISSUES);
}
