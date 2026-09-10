import { readForgeReleases, type ForgeRelease } from './read-forge-releases.js';
import { GithubAppError, type FetchLike } from '../../scm/forge/github-app.js';

/**
 * How many releases to read.
 *
 * A hundred is two pages of GitHub's default and more than most studios have
 * ever cut. Beyond that the page down the side would be a scroll nobody
 * finishes, and the ones that matter are at the top either way.
 */
const MOST_RELEASES = 100;

const PER_PAGE = 100;

export interface FetchReleasesRequest {
  readonly token: string;
  readonly apiBaseUrl: string;
  readonly repoFullName: string;
  readonly fetchImpl?: FetchLike;
}

/**
 * Reads the repository's releases.
 *
 * One page. GitHub returns newest first, so the hundred this asks for are the
 * hundred worth having — and paging until a studio's whole history is in would
 * be a button press that takes a minute and fills a page nobody scrolls.
 *
 * Drafts come back too. A draft release is a real thing a studio has, and the
 * page draws it as one rather than pretending it does not exist.
 */
export async function fetchForgeReleases(request: FetchReleasesRequest): Promise<ForgeRelease[]> {
  const { token, apiBaseUrl, repoFullName, fetchImpl = fetch } = request;
  const url = `${apiBaseUrl}/repos/${repoFullName}/releases?per_page=${String(PER_PAGE)}`;

  const response = await fetchImpl(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new GithubAppError(describeFailure(response.status, repoFullName));
  }

  return readForgeReleases(await response.json()).slice(0, MOST_RELEASES);
}

/**
 * What went wrong, in terms somebody configuring this can act on.
 *
 * A studio reading "404" against a repository they can see in their browser
 * learns nothing; what they need to know is that the installation does not
 * cover it, which is a thing they can go and change.
 */
function describeFailure(status: number, repoFullName: string): string {
  if (status === 404) {
    return `The app cannot see ${repoFullName}. Check the installation covers this repository.`;
  }

  if (status === 401 || status === 403) {
    return `The app is not allowed to read releases from ${repoFullName}. Check its permissions.`;
  }

  return `The forge answered ${String(status)} when asked for the releases of ${repoFullName}.`;
}
