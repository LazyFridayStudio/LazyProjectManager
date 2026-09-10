import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { calendarDateSchema, projectSlugSchema } from '../../projects/project-vocabulary.js';
import { milestoneStateSchema } from '../milestone-vocabulary.js';

/**
 * One milestone, with what the board says about it.
 *
 * Everything countable is counted from the cards pointing at it, so a milestone
 * cannot disagree with the board it summarises. `capacityPoints` is the one
 * stored figure, because it is a decision rather than a count.
 */
export const milestoneSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  goal: z.string().nullable(),
  startsOn: calendarDateSchema,
  shipsOn: calendarDateSchema,
  capacityPoints: z.number().int().nullable(),
  state: milestoneStateSchema,
  /** Negative once it has passed, which is how "3 days left" becomes "9 days over". */
  daysLeft: z.number().int(),
  openCount: z.number().int(),
  closedCount: z.number().int(),
  pointsClosed: z.number().int(),
  pointsTotal: z.number().int(),
  /** Open cards somebody has marked as stuck, which is what a plan is at risk from. */
  blockedCount: z.number().int(),
});

export const milestonePlanViewSchema = z.object({
  project: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    code: z.string(),
  }),
  milestones: z.array(milestoneSchema),
  /** Today where the install runs, so the client marks the same day the server did. */
  today: calendarDateSchema,
});

export type MilestonePlanView = z.infer<typeof milestonePlanViewSchema>;
export type Milestone = z.infer<typeof milestoneSchema>;

/**
 * The release plan: every date the project is held to, in the order they land.
 *
 * All of them rather than the next few. A plan is read to see what is coming
 * after the thing that is late, and one that only shows the current milestone
 * is a plan that cannot answer that.
 */
export const milestonePlanQuery = defineQuery(
  'milestones.plan',
  z.object({ slug: projectSlugSchema }),
  milestonePlanViewSchema,
);
