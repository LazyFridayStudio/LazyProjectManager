import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { projectSlugSchema } from '../project-vocabulary.js';

/**
 * How the work is going.
 *
 * Open and closed rather than a percentage, because a percentage of what is the
 * question a producer actually has — and points are the only unit anybody here
 * estimates in.
 */
export const dashboardWorkSchema = z.object({
  openCount: z.number().int(),
  closedCount: z.number().int(),
  /** Cards somebody has marked as stuck. The number a stand-up is about. */
  blockedCount: z.number().int(),
  /** Past their date and not finished. Counted against today, not against a sprint. */
  overdueCount: z.number().int(),
  /** Due in the next seven days, which is the horizon anybody plans on. */
  dueSoonCount: z.number().int(),
  pointsClosed: z.number().int(),
  pointsTotal: z.number().int(),
  /**
   * Open cards by what kind of work they are, so bugs can be read on their own.
   *
   * Every kind, including the ones with nothing in them. A count drawn from
   * only what is populated is one whose shape changes as a project fills.
   */
  openByType: z.object({
    art: z.number().int(),
    task: z.number().int(),
    bug: z.number().int(),
    build: z.number().int(),
  }),
});

/**
 * How far along the things being made are.
 *
 * The five stages an asset goes through, in order, so the shape of the pipeline
 * is legible: a project with everything in `concept` and a project with
 * everything in `review` are in very different trouble.
 */
export const dashboardPipelineSchema = z.object({
  total: z.number().int(),
  byStatus: z.object({
    concept: z.number().int(),
    wip: z.number().int(),
    review: z.number().int(),
    approved: z.number().int(),
    final: z.number().int(),
  }),
  /** Assets past their date and not yet approved. */
  overdueCount: z.number().int(),
  /** How many have nobody's name on them, which is usually the real bottleneck. */
  unassignedCount: z.number().int(),
});

/**
 * What it is going to cost, against what was set aside.
 *
 * Estimated is every asset's estimate; committed is the part already approved
 * or final, which is the number that will not now go down. Both against the
 * project's budget, which may be null — a studio that has not decided yet is a
 * normal state, not a zero.
 */
export const dashboardBudgetSchema = z.object({
  budgetMinor: z.number().int().nullable(),
  estimatedMinor: z.number().int(),
  committedMinor: z.number().int(),
});

export const projectDashboardViewSchema = z.object({
  project: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    code: z.string(),
    currency: z.string(),
    startsOn: z.string().nullable(),
    shipsOn: z.string().nullable(),
    /** Set when the studio has said the dates are not decided yet. */
    datesTbd: z.boolean(),
    archived: z.boolean(),
  }),
  work: dashboardWorkSchema,
  pipeline: dashboardPipelineSchema,
  budget: dashboardBudgetSchema,
});

export type ProjectDashboardView = z.infer<typeof projectDashboardViewSchema>;

/**
 * The state of a project, on one screen.
 *
 * Everything here is counted from what the product already holds — cards,
 * assets, the budget on the project. Nothing is entered twice and nothing is
 * cached: a dashboard that could disagree with the board it summarises is worse
 * than no dashboard.
 */
export const projectDashboardQuery = defineQuery(
  'projects.dashboard',
  z.object({ slug: projectSlugSchema }),
  projectDashboardViewSchema,
);
