import { z } from 'zod';

/**
 * The words the client, the server and the database all use about a project.
 *
 * This is the only definition of them. The check constraints in migration
 * `0002-projects` repeat the literals on purpose: a migration is a frozen record
 * of what already ran, so it must not change meaning when this list grows.
 */

/** The stages a project moves through, in the order they happen. */
export const PROJECT_PHASES = [
  'prototype',
  'pre_production',
  'production',
  'vertical_slice',
  'content_complete',
  'alpha',
  'beta',
  'shipped',
] as const;

export type ProjectPhase = (typeof PROJECT_PHASES)[number];

export const projectPhaseSchema = z.enum(PROJECT_PHASES);

const PHASE_LABELS: Readonly<Record<ProjectPhase, string>> = {
  prototype: 'Prototype',
  pre_production: 'Pre-production',
  production: 'Production',
  vertical_slice: 'Vertical slice',
  content_complete: 'Content complete',
  alpha: 'Alpha',
  beta: 'Beta',
  shipped: 'Shipped',
};

/** How a phase is written on screen. */
export function describeProjectPhase(phase: ProjectPhase): string {
  return PHASE_LABELS[phase];
}

/** The card types a project issues keys for, as in `EXMP-ART-208`. */
export const CARD_SEQUENCE_PREFIXES = ['ART', 'TASK', 'BUG', 'BUILD'] as const;

export type CardSequencePrefix = (typeof CARD_SEQUENCE_PREFIXES)[number];

export const MINIMUM_PROJECT_CODE_LENGTH = 2;
export const MAXIMUM_PROJECT_CODE_LENGTH = 10;

/**
 * Uppercase letters and digits, starting with a letter.
 *
 * A code is the root of every ticket key in the project, so it has to survive
 * being typed into a commit message and read back off a whiteboard.
 */
export const PROJECT_CODE_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

export const projectNameSchema = z.string().trim().min(1, 'Name the project.').max(80);

export const projectCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    PROJECT_CODE_PATTERN,
    `Use ${String(MINIMUM_PROJECT_CODE_LENGTH)} to ${String(MAXIMUM_PROJECT_CODE_LENGTH)} letters or digits, starting with a letter.`,
  );

export const projectSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(90)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'That is not a project address.');

/** Free text: engines version faster than any list of them could be maintained. */
export const projectEngineSchema = z.string().trim().min(1).max(40);

/** A calendar day with no time and no zone, as `2026-08-18`. */
export const calendarDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-08-18.');

/**
 * A budget in minor units — cents, for AUD.
 *
 * Money is integer arithmetic everywhere and is formatted once, at the edge, so
 * no rounding error can accumulate between the two.
 */
export const budgetMinorSchema = z
  .number()
  .int('Budgets are whole cents.')
  .min(0, 'A budget cannot be negative.')
  // Well past any studio's budget, and far below the point where a JavaScript
  // number stops holding an exact integer.
  .max(1_000_000_000_000, 'That budget is not a real number.');

/** ISO 4217, e.g. `AUD`. */
export const currencySchema = z.string().trim().toUpperCase().length(3);

/**
 * The fastest the clock may come round for a repository.
 *
 * A sync is a handful of requests per project against a rate limit of five
 * thousand an hour, which a minute fits comfortably and a second does not. The
 * database holds the same floor, so a script cannot ask for what the screen
 * cannot offer.
 */
export const FASTEST_SYNC_SECONDS = 60;

/**
 * How often a repository is synced, in seconds, and null for not on a clock.
 *
 * Seconds rather than minutes because the floor is the interesting end. A short
 * list rather than a free number: the useful answers are "as fast as it goes",
 * "a few times an hour" and "leave it alone", and a box somebody can type 90
 * into is a box somebody has to think about.
 */
export const SYNC_EVERY_CHOICES = [60, 300, 900, 1800, 3600] as const;

export type SyncEveryChoice = (typeof SYNC_EVERY_CHOICES)[number];

export const syncEverySecondsSchema = z
  .number()
  .int('An interval is whole seconds.')
  .min(FASTEST_SYNC_SECONDS, 'A minute is as often as a repository can be synced.')
  // A day. Past this the clock is off in everything but name, and Off says so.
  .max(86_400, 'A repository synced less than once a day is one with the clock off.');

/**
 * What a chosen interval is called, including the one that is not an interval.
 *
 * Null is Off, and the words say what Off leaves working — a setting that reads
 * as "never sync" when the button and the webhook still do would be a setting
 * that lies.
 */
export function describeSyncEvery(seconds: number | null): string {
  if (seconds === null) {
    return 'Off — only when the repository says so, or when you press Sync';
  }

  return SYNC_EVERY_LABELS[seconds] ?? `Every ${String(seconds)} seconds`;
}

const SYNC_EVERY_LABELS: Readonly<Record<number, string>> = {
  60: 'Every minute',
  300: 'Every 5 minutes',
  900: 'Every 15 minutes',
  1800: 'Every half hour',
  3600: 'Every hour',
};

/**
 * The key a card is referred to by, everywhere from the board to a commit
 * message: `EXMP-ART-208`.
 */
export function formatCardKey(projectCode: string, prefix: string, value: number): string {
  return `${projectCode}-${prefix}-${String(value)}`;
}
