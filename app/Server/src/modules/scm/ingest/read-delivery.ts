import type { ScmLinkKind, ScmProvider } from '@lpm/shared';

/**
 * Turns one delivery into the things it says happened.
 *
 * Read defensively rather than parsed strictly. This is somebody else's JSON,
 * three providers spell it differently, and it changes when they feel like it —
 * so a field that is missing or the wrong shape means "that part is not there",
 * not an exception that stops the rest of the batch. Nothing here throws.
 *
 * It reads what a delivery says, and says nothing about which cards it touches:
 * that is `findCardKeys`, over `searchIn`.
 */

export interface DeliveredActivity {
  readonly kind: ScmLinkKind;
  /** The commit sha, the branch name, or `#41` — whatever names this thing. */
  readonly ref: string;
  readonly url: string | null;
  readonly author: string | null;
  readonly message: string | null;
  readonly occurredAt: Date;
  /** The text card keys are looked for in, which is not always the message. */
  readonly searchIn: string;
}

/** Long enough to identify a commit, short enough to read. */
const SHORT_SHA_LENGTH = 7;

export function readDelivery(
  provider: ScmProvider,
  eventName: string,
  payload: unknown,
): readonly DeliveredActivity[] {
  const body = asRecord(payload);

  if (body === null) {
    return [];
  }

  if (isPushEvent(provider, eventName, body)) {
    return [...readBranch(body), ...readCommits(body)];
  }

  if (isPullRequestEvent(provider, eventName)) {
    return readPullRequest(provider, body);
  }

  // A delivery nothing here reads is not a failure. Providers send far more
  // than this cares about, and the payload is kept either way.
  return [];
}

/**
 * GitHub and Gitea call it `push`; GitLab says so in the body.
 *
 * The header is trusted first because it is what the provider named the
 * delivery, and the body only when there is no header worth reading.
 */
function isPushEvent(
  provider: ScmProvider,
  eventName: string,
  body: Readonly<Record<string, unknown>>,
): boolean {
  return provider === 'gitlab'
    ? asString(body.object_kind) === 'push' || eventName === 'Push Hook'
    : eventName === 'push';
}

function isPullRequestEvent(provider: ScmProvider, eventName: string): boolean {
  return provider === 'gitlab' ? eventName === 'Merge Request Hook' : eventName === 'pull_request';
}

/**
 * The branch itself, when a push created or moved one.
 *
 * Separate from the commits on purpose: a branch called
 * `feature/LPMT-ART-2-crane-textures` names a card even when not one commit on
 * it does, and that is how most people say what they are working on.
 */
function readBranch(body: Readonly<Record<string, unknown>>): readonly DeliveredActivity[] {
  const branch = readBranchName(asString(body.ref));

  if (branch === null) {
    return [];
  }

  const head = asRecord(body.head_commit);

  return [
    {
      kind: 'branch',
      ref: branch,
      url: asString(body.compare) ?? asString(body.compare_url),
      author: readPusher(body),
      message: null,
      occurredAt: readDate(head?.timestamp),
      searchIn: branch,
    },
  ];
}

function readCommits(body: Readonly<Record<string, unknown>>): readonly DeliveredActivity[] {
  return asArray(body.commits).flatMap((entry): readonly DeliveredActivity[] => {
    const commit = asRecord(entry);
    const sha = asString(commit?.id);

    if (commit === null || sha === null) {
      return [];
    }

    const message = asString(commit.message) ?? '';

    return [
      {
        kind: 'commit',
        ref: sha.slice(0, SHORT_SHA_LENGTH),
        url: asString(commit.url),
        author: readAuthor(commit),
        // The subject only. A card showing thirty lines of body is a card
        // nobody can see the rest of.
        message: firstLine(message),
        occurredAt: readDate(commit.timestamp),
        // The whole message, though: a key is as often in the body as the
        // subject.
        searchIn: message,
      },
    ];
  });
}

function readPullRequest(
  provider: ScmProvider,
  body: Readonly<Record<string, unknown>>,
): readonly DeliveredActivity[] {
  const request = asRecord(provider === 'gitlab' ? body.object_attributes : body.pull_request);
  const number = request === null ? null : (asNumber(request.number) ?? asNumber(request.iid));

  if (request === null || number === null) {
    return [];
  }

  const title = asString(request.title) ?? '';

  return [
    {
      kind: 'pull_request',
      ref: `#${String(number)}`,
      url: asString(request.html_url) ?? asString(request.url),
      author: readAuthor(body) ?? readAuthor(request),
      message: title,
      occurredAt: readDate(request.updated_at ?? request.created_at),
      searchIn: readPullRequestText(request, title),
    },
  ];
}

/**
 * Everything a pull request could be naming a card in.
 *
 * The branch as well as the words: a pull request often says which card it is
 * only in the name of the branch it came from, which is exactly the case a
 * title-only search misses.
 */
function readPullRequestText(request: Readonly<Record<string, unknown>>, title: string): string {
  const branch =
    readBranchName(asString(request.source_branch)) ?? asString(asRecord(request.head)?.ref) ?? '';
  const description = asString(request.body) ?? asString(request.description) ?? '';

  return [title, description, branch].filter((part) => part !== '').join('\n');
}

/** `refs/heads/main` is a branch; `refs/tags/v1` is not. */
function readBranchName(ref: string | null): string | null {
  if (ref === null) {
    return null;
  }

  const prefix = 'refs/heads/';

  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref.includes('/') ? null : ref;
}

function readPusher(body: Readonly<Record<string, unknown>>): string | null {
  const pusher = asRecord(body.pusher);

  return (
    asString(pusher?.name) ??
    asString(pusher?.username) ??
    asString(asRecord(body.sender)?.login) ??
    asString(body.user_name)
  );
}

/**
 * Whoever this is attributed to.
 *
 * Three providers and three names for the same field, plus `sender` — which is
 * how a pull request says who opened it, the commit fields being about the code
 * rather than the request.
 */
function readAuthor(entry: Readonly<Record<string, unknown>>): string | null {
  const author = asRecord(entry.author) ?? asRecord(entry.user) ?? asRecord(entry.sender);

  return asString(author?.name) ?? asString(author?.username) ?? asString(author?.login) ?? null;
}

function firstLine(message: string): string {
  return message.split('\n')[0]?.trim() ?? '';
}

/**
 * When it happened, or now.
 *
 * A missing or unreadable timestamp still has to sort somewhere, and the moment
 * it arrived is closer to the truth than the beginning of 1970.
 */
export function readDate(value: unknown): Date {
  const parsed = typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;

  return parsed === null || Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
