/**
 * A release as this product stores it, read out of what a forge answered.
 *
 * Separate from the view model on purpose: this is the shape of somebody
 * else's JSON after it has been understood, and nothing downstream should have
 * to know which forge it came from.
 */
export interface ForgeRelease {
  /** The forge's own id, as text. Matched on so a renamed tag moves rather than doubles. */
  readonly externalId: string;
  readonly tag: string;
  readonly name: string;
  /** `YYYY-MM-DD`, in UTC, because a release is dated rather than timed. */
  readonly publishedOn: string;
  readonly author: string;
  readonly commitSha: string | null;
  readonly isPrerelease: boolean;
  readonly isDraft: boolean;
  /** Markdown, as the forge holds it. */
  readonly notes: string;
  readonly url: string | null;
  readonly assets: readonly ForgeReleaseAsset[];
}

export interface ForgeReleaseAsset {
  readonly name: string;
  readonly sizeBytes: number | null;
  readonly downloadCount: number;
  /** Where the forge says the file is. Null for one it did not tell us about. */
  readonly downloadUrl: string | null;
}

/*
 * The forge's own field names, in the forge's own spelling.
 *
 * Snake case because that is what arrives on the wire; renaming them here would
 * mean this file no longer matched the documentation anybody checks it against.
 * Every field is `unknown` — this describes what the JSON is *called*, not what
 * can be believed about it, and each one is checked before it is used.
 */
interface ReleasePayload {
  readonly id?: unknown;
  readonly tag_name?: unknown;
  readonly name?: unknown;
  readonly body?: unknown;
  readonly published_at?: unknown;
  readonly created_at?: unknown;
  readonly target_commitish?: unknown;
  readonly prerelease?: unknown;
  readonly draft?: unknown;
  readonly html_url?: unknown;
  readonly author?: unknown;
  readonly assets?: unknown;
}

interface AssetPayload {
  readonly name?: unknown;
  readonly size?: unknown;
  readonly download_count?: unknown;
  readonly browser_download_url?: unknown;
}

interface AuthorPayload {
  readonly login?: unknown;
}

/**
 * A release the forge gave no date at all.
 *
 * Rather than today, which would put an old release at the top of the page and
 * quietly change its position every time somebody synced.
 */
const UNDATED = '1970-01-01';

/**
 * Reads a forge's releases into the shape this product stores.
 *
 * Gitea answers the same shape at the same path, which is why this is named for
 * a forge rather than for GitHub: the two share an API here, and splitting them
 * would be two copies of this function differing in nothing.
 *
 * Anything unreadable is skipped rather than thrown over. A forge that adds a
 * field, or one release in fifty with something odd in it, must not stop the
 * other forty-nine arriving — and a studio pressing Re-sync wants the releases
 * it can have, not a stack trace about the one it cannot.
 */
export function readForgeReleases(payload: unknown): ForgeRelease[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((each: unknown) => readOneRelease(each))
    .filter((release): release is ForgeRelease => release !== null);
}

function readOneRelease(payload: unknown): ForgeRelease | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const release = payload as ReleasePayload;
  const externalId = readId(release.id);
  const tag = readText(release.tag_name);

  // Without an id there is nothing to match on next time, and without a tag
  // there is nothing to call it. Either missing means this is not a release.
  if (externalId === null || tag === null) {
    return null;
  }

  return {
    externalId,
    tag,
    // A release with no name of its own is called by its tag, which is what
    // the forge's own page does with it.
    name: readText(release.name) ?? tag,
    publishedOn: readDay(release.published_at) ?? readDay(release.created_at) ?? UNDATED,
    author: readAuthor(release.author),
    commitSha: readText(release.target_commitish),
    isPrerelease: release.prerelease === true,
    isDraft: release.draft === true,
    notes: readText(release.body) ?? '',
    url: readText(release.html_url),
    assets: readAssets(release.assets),
  };
}

function readAssets(payload: unknown): ForgeReleaseAsset[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.flatMap((each: unknown): ForgeReleaseAsset[] => {
    if (typeof each !== 'object' || each === null) {
      return [];
    }

    const asset = each as AssetPayload;
    const name = readText(asset.name);

    if (name === null) {
      return [];
    }

    return [
      {
        name,
        sizeBytes: typeof asset.size === 'number' ? Math.round(asset.size) : null,
        downloadCount:
          typeof asset.download_count === 'number' ? Math.round(asset.download_count) : 0,
        // Sent by every forge this reads and thrown away until now, which is
        // why the page could list a build and not hand it to anybody.
        downloadUrl: readText(asset.browser_download_url),
      },
    ];
  });
}

/**
 * Who published it.
 *
 * The login rather than a display name: `build-bot` is what a studio sees on
 * the forge and what they would search for, and the display name of a machine
 * account is usually blank.
 */
function readAuthor(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) {
    return 'unknown';
  }

  return readText((payload as AuthorPayload).login) ?? 'unknown';
}

/** Ids arrive as numbers from GitHub and as strings elsewhere; both are text here. */
function readId(payload: unknown): string | null {
  if (typeof payload === 'number' && Number.isFinite(payload)) {
    return String(payload);
  }

  return readText(payload);
}

function readText(payload: unknown): string | null {
  if (typeof payload !== 'string') {
    return null;
  }

  const trimmed = payload.trim();

  return trimmed === '' ? null : trimmed;
}

/**
 * The day of an ISO timestamp, in UTC.
 *
 * A release is dated rather than timed, and the day it belongs to is the one
 * the forge published it on — not the one it happens to be where this is read.
 */
function readDay(payload: unknown): string | null {
  const text = readText(payload);

  if (text === null) {
    return null;
  }

  const when = new Date(text);

  return Number.isNaN(when.getTime()) ? null : when.toISOString().slice(0, 10);
}
