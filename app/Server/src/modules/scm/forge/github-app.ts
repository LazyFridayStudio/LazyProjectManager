import { createSign } from 'node:crypto';

/**
 * How long the assertion the app signs is good for.
 *
 * GitHub refuses anything over ten minutes. Nine leaves room for a clock a
 * little ahead of theirs without going over — the assertion is thrown away
 * seconds later either way, since it exists only to be exchanged for a token.
 */
const ASSERTION_LIFETIME_SECONDS = 9 * 60;

/**
 * How far back the assertion claims to have been issued.
 *
 * A server whose clock is a few seconds ahead of the forge's would otherwise
 * present something issued in the future, which is refused. Backdating by a
 * minute costs nothing and removes a class of failure that looks like a wrong
 * key.
 */
const CLOCK_SKEW_SECONDS = 60;

export interface GithubAppCredentials {
  readonly appId: string;
  readonly installationId: string;
  /** PEM, as GitHub hands it out. */
  readonly privateKey: string;
  /** The API root. GitHub's own unless this is an Enterprise install. */
  readonly apiBaseUrl: string;
}

export interface InstallationToken {
  readonly token: string;
  readonly expiresAt: Date;
}

/** What went wrong, in the terms somebody configuring this can act on. */
export class GithubAppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GithubAppError';
  }
}

/**
 * The assertion an app presents to say who it is.
 *
 * A JSON Web Token signed with the app's private key: header and payload,
 * base64url, joined by a dot, and the signature of that over RS256. Written
 * here rather than pulled in as a dependency because this is the whole of it —
 * three lines of encoding and one call into `node:crypto` — and a library for
 * it would be a library to keep patched for the sake of those three lines.
 */
export function createAppAssertion(
  credentials: Pick<GithubAppCredentials, 'appId' | 'privateKey'>,
  now: Date,
): string {
  const issuedAt = Math.floor(now.getTime() / 1000) - CLOCK_SKEW_SECONDS;

  const header = encodeSegment({ alg: 'RS256', typ: 'JWT' });
  const payload = encodeSegment({
    iat: issuedAt,
    exp: issuedAt + ASSERTION_LIFETIME_SECONDS,
    iss: credentials.appId,
  });

  const signed = `${header}.${payload}`;

  try {
    const signature = createSign('RSA-SHA256').update(signed).sign(credentials.privateKey);

    return `${signed}.${toBase64Url(signature)}`;
  } catch {
    // A key that will not sign is a key that was pasted wrong, which is worth
    // saying plainly: the alternative is an OpenSSL message in a settings form.
    throw new GithubAppError(
      'That private key could not be read. Paste the whole PEM file, including its BEGIN and END lines.',
    );
  }
}

/** The `fetch` the client uses, so a test can answer without a network. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Trades the assertion for a token that can actually read the repository.
 *
 * The assertion says which app this is; the token says which installation of it,
 * and that is what carries the permissions a studio granted on their repository.
 * It lasts an hour, which is why the caller is expected to hold on to it.
 */
export async function requestInstallationToken(
  credentials: GithubAppCredentials,
  now: Date,
  fetchImpl: FetchLike = fetch,
): Promise<InstallationToken> {
  const assertion = createAppAssertion(credentials, now);
  const url = `${credentials.apiBaseUrl}/app/installations/${credentials.installationId}/access_tokens`;

  const response = await callForge(fetchImpl, url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${assertion}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new GithubAppError(describeTokenFailure(response.status));
  }

  const body = (await response.json()) as { token?: unknown; expires_at?: unknown };

  if (typeof body.token !== 'string' || typeof body.expires_at !== 'string') {
    throw new GithubAppError('The forge answered with something that was not a token.');
  }

  return { token: body.token, expiresAt: new Date(body.expires_at) };
}

/**
 * Checks the installation actually covers this repository.
 *
 * A token proves the app is who it says it is; it does not prove the studio
 * installed it anywhere useful. Somebody who granted access to the wrong
 * repository should be told now, in a form they are still looking at, rather
 * than by nothing ever appearing on a card.
 */
export async function assertRepositoryAccess(
  request: { readonly token: string; readonly apiBaseUrl: string; readonly repoFullName: string },
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const response = await callForge(
    fetchImpl,
    `${request.apiBaseUrl}/repos/${request.repoFullName}`,
    {
      headers: {
        authorization: `Bearer ${request.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    },
  );

  if (response.status === 404) {
    throw new GithubAppError(
      `The app is installed, but not on ${request.repoFullName}. Add that repository to the installation.`,
    );
  }

  if (!response.ok) {
    throw new GithubAppError(
      `The forge refused to describe ${request.repoFullName} (${String(response.status)}).`,
    );
  }
}

/**
 * One place the network is actually touched.
 *
 * A forge that is unreachable and a forge that says no are different problems
 * with different fixes, and the distinction is lost if a thrown `fetch` reaches
 * a settings screen as "failed to fetch".
 */
async function callForge(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch {
    throw new GithubAppError('The forge could not be reached. Check the endpoint and try again.');
  }
}

function describeTokenFailure(status: number): string {
  if (status === 401) {
    return 'The forge would not accept that app id and private key.';
  }

  if (status === 404) {
    return 'That installation does not exist, or this app is not installed on it.';
  }

  return `The forge refused to issue a token (${String(status)}).`;
}

function encodeSegment(value: Record<string, unknown>): string {
  return toBase64Url(Buffer.from(JSON.stringify(value), 'utf8'));
}

/** Base64url: base64 with the two URL-unsafe characters swapped and no padding. */
function toBase64Url(bytes: Buffer): string {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
