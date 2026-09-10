import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { membershipRoleSchema } from '../../identity/queries/me.js';
import { switchableProjectSectionSchema } from '../project-sections.js';
import { projectSlugSchema } from '../project-vocabulary.js';
import { projectSummarySchema } from './project-list.js';

export const projectMemberSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  initials: z.string(),
  avatarUrl: z.string().nullable(),
  role: membershipRoleSchema,
  /** Hours a day this person has for this project, which the timeline plans on. */
  joinedAt: z.string(),
});

/**
 * A team on a project.
 *
 * A standing grant: everybody in the team reaches the project for as long as
 * they are in it. The count is the whole question a producer is asking of the
 * row — how many people this one line is putting on the project. What those
 * people may do once they are there is the team's permission groups, which is a
 * question answered on the Teams screen and not on this one.
 */
export const projectTeamSchema = z.object({
  teamId: z.string().uuid(),
  name: z.string(),
  memberCount: z.number().int().nonnegative(),
  /** Null for a team nobody answers for yet, or whose lead has left. */
  leadDisplayName: z.string().nullable(),
});

export type ProjectTeam = z.infer<typeof projectTeamSchema>;

/**
 * A counter and the key it will hand out next, so the settings screen can say
 * `Next: EXMP-ART-209` rather than making somebody guess.
 */
export const cardSequenceSchema = z.object({
  prefix: z.string(),
  nextValue: z.number().int().positive(),
});

export const projectDetailViewSchema = z.object({
  project: projectSummarySchema,
  /**
   * The people on it by name.
   *
   * Not everybody who reaches it: somebody in a team that is on the project is
   * not on this list, because there is no row here to take off them. Both are
   * drawn on the settings screen, as the two separate things they are.
   */
  members: z.array(projectMemberSchema),
  teams: z.array(projectTeamSchema),
  sequences: z.array(cardSequenceSchema),
  /**
   * The sections this project has switched off.
   *
   * Here rather than on the summary because the settings screen is the only
   * thing that draws the switches; every other screen asks the sidebar, which
   * has already put this together with what the person may open.
   */
  disabledSections: z.array(switchableProjectSectionSchema),
  /** Whether a sync leaves this repository's closed history where it is. */
  syncOpenIssuesOnly: z.boolean(),
  /** How often the clock comes round for this repository. Null is not at all. */
  syncEverySeconds: z.number().int().nullable(),
});

export type ProjectDetailView = z.infer<typeof projectDetailViewSchema>;

/**
 * One project, addressed the way its URL addresses it. Backs the project
 * settings screen.
 */
export const projectDetailQuery = defineQuery(
  'projects.detail',
  z.object({ slug: projectSlugSchema }),
  projectDetailViewSchema,
);
