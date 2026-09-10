import { z } from 'zod';

import { SCM_PROVIDERS } from '../scm/scm-vocabulary.js';

/**
 * What everybody calls the release.
 *
 * Anything somebody would write on a tag: `v0.9.4`, `2026.08-vertical-slice`,
 * `demo-build-3`. Not validated into a shape, because a studio's tagging
 * convention is theirs and a product that refuses `alpha_final` is one people
 * work around by putting the real tag in the name.
 */
export const releaseTagSchema = z.string().trim().min(1, 'Give it a tag.').max(80);

export const releaseNameSchema = z.string().trim().min(1, 'Name the release.').max(200);

/** Who published it. Usually `build-bot`, which is why it is a name and not a user. */
export const releaseAuthorSchema = z.string().trim().min(1, 'Say who published it.').max(80);

/** As long as a changelog needs to be, which is longer than anybody expects. */
export const releaseNotesSchema = z.string().max(100_000);

/** A calendar day, as `YYYY-MM-DD`. */
export const releaseDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Use a real date.');

const KILOBYTE = 1024;
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * How big a file is, in the unit somebody would say out loud.
 *
 * Powers of two, which is what a file manager shows and therefore what anybody
 * comparing the two would expect.
 */
export function describeFileSize(bytes: number | null): string {
  if (bytes === null) {
    return '—';
  }

  let size = bytes;
  let unit = 0;

  while (size >= KILOBYTE && unit < UNITS.length - 1) {
    size /= KILOBYTE;
    unit += 1;
  }

  // Whole numbers under a megabyte, one decimal above: `840 KB` and `4.2 GB`
  // are how these are said, and `4.19 GB` is nobody's idea of clearer.
  const rounded = unit === 0 ? Math.round(size) : Math.round(size * 10) / 10;

  return `${String(rounded)} ${UNITS[unit] ?? 'B'}`;
}

const SIZE = /^\s*(\d+(?:\.\d+)?)\s*([kmgt]?b)?\s*$/iu;

const BYTES_IN: Record<string, number> = {
  b: 1,
  kb: KILOBYTE,
  mb: KILOBYTE ** 2,
  gb: KILOBYTE ** 3,
  tb: KILOBYTE ** 4,
};

/**
 * A size somebody typed, as bytes.
 *
 * `4.2 GB`, `820MB`, `1024`. Nobody types a byte count for a game build, and
 * asking them to would be asking them to do arithmetic this can do.
 *
 * Null for anything it cannot read, which is treated as "nobody measured it"
 * rather than as an error: the size of a download is worth less than the row
 * saying the download exists.
 */
export function readFileSize(typed: string): number | null {
  const match = SIZE.exec(typed);
  const amount = Number(match?.[1]);

  if (match === null || !Number.isFinite(amount)) {
    return null;
  }

  // A bare number is bytes, which is what `1024` in a box means.
  const scale = BYTES_IN[(match[2] ?? 'b').toLowerCase()] ?? 1;

  return Math.round(amount * scale);
}

/** Which of the three things a release can be, in the word the design uses. */
export type ReleaseKind = 'latest' | 'pre-release' | 'draft';

/**
 * What to call a release on screen.
 *
 * Draft beats pre-release: something unfinished is unfinished whatever it was
 * going to be, and it is the more important of the two to see.
 */
export function describeReleaseKind(release: {
  isDraft: boolean;
  isPrerelease: boolean;
}): ReleaseKind {
  if (release.isDraft) return 'draft';

  return release.isPrerelease ? 'pre-release' : 'latest';
}

/**
 * Where a release came from.
 *
 * `hand` is somebody typing it in, which is what the Builds page did before a
 * repository could fill it in. The rest are the forge that owns the row.
 *
 * The distinction earns its keep in one rule: a release entered by hand is
 * never overwritten by a sync, and a release a forge owns is refreshed from it
 * every time. Without a source there is no way to hold that line.
 */
export const RELEASE_SOURCES = ['hand', ...SCM_PROVIDERS] as const;

export type ReleaseSource = (typeof RELEASE_SOURCES)[number];

export const releaseSourceSchema = z.enum(RELEASE_SOURCES);
