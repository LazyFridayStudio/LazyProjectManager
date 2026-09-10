/**
 * An issue as this product stores it, read out of what a forge answered.
 *
 * Separate from the card it becomes on purpose: this is the shape of somebody
 * else's JSON after it has been understood, and nothing downstream should have
 * to know which forge it came from.
 */
export interface ForgeIssue {
  /** The forge's own id, as text. Matched on, because a number belongs to a repository. */
  readonly externalId: string;
  /** `41`, as the issue is spoken about. Shown, never matched on. */
  readonly ref: string;
  readonly title: string;
  /** Markdown, as the forge holds it. */
  readonly body: string | null;
  readonly isClosed: boolean;
  /**
   * When the forge last saw it change.
   *
   * The whole of how a two-way sync decides who wins: the side that changed
   * last is the side that is right, and this is the forge's half of that
   * comparison.
   */
  readonly updatedAt: Date;
  readonly url: string | null;
  /**
   * As the forge spells them.
   *
   * Kept in their own case rather than folded, because a label is also an
   * address: taking one off an issue names it back to the forge, and `Backlog`
   * and `backlog` are not the same address even where they are the same label.
   */
  readonly labels: readonly string[];
}

/*
 * The forge's own field names, in the forge's own spelling.
 *
 * Snake case because that is what arrives on the wire; renaming them here would
 * mean this file no longer matched the documentation anybody checks it against.
 * Every field is `unknown` — this describes what the JSON is *called*, not what
 * can be believed about it, and each one is checked before it is used.
 */
interface IssuePayload {
  readonly id?: unknown;
  readonly number?: unknown;
  readonly title?: unknown;
  readonly body?: unknown;
  readonly state?: unknown;
  readonly updated_at?: unknown;
  readonly html_url?: unknown;
  readonly labels?: unknown;
  readonly pull_request?: unknown;
}

interface LabelPayload {
  readonly name?: unknown;
}

/**
 * Reads a forge's issues into the shape this product stores.
 *
 * Gitea answers the same shape at the same path, which is why this is named for
 * a forge rather than for GitHub: the two share an API here, and splitting them
 * would be two copies of this function differing in nothing.
 *
 * Anything unreadable is skipped rather than thrown over. A forge that adds a
 * field, or one issue in fifty with something odd in it, must not stop the other
 * forty-nine arriving — and somebody pressing the button wants the issues they
 * can have, not a stack trace about the one they cannot.
 */
export function readForgeIssues(payload: unknown): ForgeIssue[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((each: unknown) => readOneIssue(each))
    .filter((issue): issue is ForgeIssue => issue !== null);
}

function readOneIssue(payload: unknown): ForgeIssue | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const issue = payload as IssuePayload;

  /*
   * Pull requests come back from this endpoint too.
   *
   * GitHub models one as an issue with a `pull_request` on it, so asking for
   * issues asks for both — and a board filling up with a card per pull request
   * is not what anybody meant by "put the issues on it". The commits and the
   * pull request itself already reach the card they name, through the webhook.
   */
  if (issue.pull_request !== undefined && issue.pull_request !== null) {
    return null;
  }

  const externalId = readId(issue.id);
  const ref = readId(issue.number);
  const title = readText(issue.title);

  // Without an id there is nothing to match on next time, and without a title
  // there is nothing to put on a card. Either missing means this is not one.
  if (externalId === null || ref === null || title === null) {
    return null;
  }

  return {
    externalId,
    ref,
    title,
    body: readText(issue.body),
    // Anything that is not open is closed. A forge that grows a third state
    // would be describing something this board has no column for either way.
    isClosed: readText(issue.state) !== 'open',
    updatedAt: readWhen(issue.updated_at),
    url: readText(issue.html_url),
    labels: readLabels(issue.labels),
  };
}

function readLabels(payload: unknown): string[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.flatMap((each: unknown): string[] => {
    // A label is an object on GitHub and a string on some others.
    const name =
      typeof each === 'object' && each !== null
        ? readText((each as LabelPayload).name)
        : readText(each);

    return name === null ? [] : [name];
  });
}

/** Ids arrive as numbers from GitHub and as strings elsewhere; both are text here. */
function readId(payload: unknown): string | null {
  if (typeof payload === 'number' && Number.isFinite(payload)) {
    return String(payload);
  }

  return readText(payload);
}

/**
 * When the forge says it changed.
 *
 * The beginning of time when it will not say, so an issue with no date never
 * wins a comparison against a card somebody has actually touched.
 */
function readWhen(payload: unknown): Date {
  const text = readText(payload);
  const when = text === null ? null : new Date(text);

  return when === null || Number.isNaN(when.getTime()) ? new Date(0) : when;
}

function readText(payload: unknown): string | null {
  if (typeof payload !== 'string') {
    return null;
  }

  const trimmed = payload.trim();

  return trimmed === '' ? null : trimmed;
}
