import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';

/**
 * How many faces a tile shows before it stops.
 *
 * A team of two hundred is a tile with two hundred initials on it, which says
 * less than five and a number does.
 */
export const TEAM_TILE_FACES = 5;

export const teamPersonSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  initials: z.string(),
  /** Their picture, or null for somebody drawn as their initials. */
  avatarUrl: z.string().nullable(),
});

export const teamSummarySchema = z.object({
  teamId: z.string().uuid(),
  name: z.string(),
  /** What it can do to a project no exception mentions. */
  /** How many exceptions it has, so a tile says whether to go and look. */
  /** Null for a team nobody answers for yet, or whose lead has left. */
  lead: teamPersonSchema.nullable(),
  memberCount: z.number().int().nonnegative(),
  /** The first few, to draw on the tile. Not the whole team. */
  faces: z.array(teamPersonSchema),
});

export type TeamSummary = z.infer<typeof teamSummarySchema>;

export const teamListViewSchema = z.object({
  teams: z.array(teamSummarySchema),
});

export type TeamListView = z.infer<typeof teamListViewSchema>;

/**
 * Every team on the install, alphabetically.
 *
 * Not paged, unlike the people: a studio of a thousand has tens of teams, and a
 * grid of tens of tiles is the screen. If an install ever has hundreds, that is
 * the moment to page this — and the moment somebody will say so.
 */
export const teamListQuery = defineQuery('teams.list', z.object({}), teamListViewSchema);
