import { z } from 'zod';

export const milestoneNameSchema = z.string().trim().min(1, 'Name the milestone.').max(80);

/** One sentence the team can hold itself to. Longer than that is a design doc. */
export const milestoneGoalSchema = z.string().trim().max(280);

/**
 * Points the team believed it could take on.
 *
 * A decision rather than a count, which is why it is stored while everything
 * else about a milestone is worked out from the cards pointing at it. Keeping
 * it is the only way to say afterwards whether the plan was wrong or the
 * fortnight was.
 */
export const milestoneCapacitySchema = z.number().int().min(0).max(10_000);

/**
 * Where a milestone is relative to today.
 *
 * Derived from its dates rather than stored. A state somebody has to remember
 * to change is a state that says "Active" about a milestone that ended in
 * March.
 */
export const MILESTONE_STATES = ['planned', 'active', 'shipped'] as const;

export type MilestoneState = (typeof MILESTONE_STATES)[number];

export const milestoneStateSchema = z.enum(MILESTONE_STATES);

export function describeMilestoneState(state: MilestoneState): string {
  const NAMES: Readonly<Record<MilestoneState, string>> = {
    planned: 'Planned',
    active: 'Active',
    shipped: 'Shipped',
  };

  return NAMES[state];
}

/**
 * Which of `planned`, `active` and `shipped` a milestone is in on a given day.
 *
 * Inclusive at both ends: a milestone that ships today is still active today,
 * because the day it is due is a day people are working on it.
 */
export function readMilestoneState(
  milestone: { readonly startsOn: string; readonly shipsOn: string },
  today: string,
): MilestoneState {
  if (today < milestone.startsOn) return 'planned';

  return today > milestone.shipsOn ? 'shipped' : 'active';
}

/**
 * Days from today until a milestone ships, negative once it has passed.
 *
 * Whole days in UTC, as every other date calculation here: measured locally, a
 * fortnight across a daylight saving change is a fortnight and an hour.
 */
export function daysUntil(date: string, today: string): number {
  const MILLISECONDS_PER_DAY = 86_400_000;

  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / MILLISECONDS_PER_DAY,
  );
}
