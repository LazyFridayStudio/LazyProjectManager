import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { membershipRoleSchema } from '../../identity/queries/me.js';
import { projectPhaseSchema } from '../project-vocabulary.js';

/** Which projects the launcher is asking for. Matches its filter chips. */
export const projectScopeSchema = z.enum(['live', 'archived', 'all']);

export type ProjectScope = z.infer<typeof projectScopeSchema>;

/**
 * The three numbers on a project tile.
 *
 * `assets` and `openTasks` are zero until those tables exist. They are in the
 * view now so the tile's shape is settled — a screen that grows a row later is
 * a screen that gets re-laid-out later.
 */
export const projectCountsSchema = z.object({
  assets: z.number().int().nonnegative(),
  openTasks: z.number().int().nonnegative(),
  team: z.number().int().nonnegative(),
});

export const projectSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  slug: z.string(),
  engine: z.string().nullable(),
  phase: projectPhaseSchema,
  /** The signed-in person's role in this project, shown on the tile. */
  role: membershipRoleSchema,
  /** Minor units, formatted against `currency` at the edge. */
  budgetMinor: z.number().nullable(),
  currency: z.string(),
  startsOn: z.string().nullable(),
  shipsOn: z.string().nullable(),
  datesTbd: z.boolean(),
  archivedAt: z.string().nullable(),
  /**
   * The tile's image, signed and short-lived, or null.
   *
   * Null covers three things a screen treats alike: no key art chosen, one
   * chosen but not yet resized, and one nothing could decode.
   */
  keyArtUrl: z.string().nullable(),
  /**
   * The square mark, on the same terms as the key art above it.
   *
   * A project without one is drawn as the first letter of its name, which is
   * what every project looked like before a logo could be chosen at all.
   */
  logoUrl: z.string().nullable(),
  counts: projectCountsSchema,
  updatedAt: z.string(),
});

export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const projectListViewSchema = z.object({
  projects: z.array(projectSummarySchema),
});

export type ProjectListView = z.infer<typeof projectListViewSchema>;

/**
 * The launcher. Every project the signed-in person can open, newest first.
 *
 * Scoped to their memberships rather than to the account: someone brought in to
 * finish one contract sees that one project, not the whole studio.
 */
export const projectListQuery = defineQuery(
  'projects.list',
  z.object({ scope: projectScopeSchema.default('live') }),
  projectListViewSchema,
);
