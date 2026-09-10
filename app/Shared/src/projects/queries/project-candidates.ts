import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';

/**
 * How many of each a picker draws before it asks for a better search.
 *
 * The same number the team picker on the Teams screen shows, for the same
 * reason: a list somebody scrolls is a list they read the top of, and the way
 * to find the ninth name is to type more of it rather than to scroll past
 * eight.
 */
export const PROJECT_CANDIDATES_SHOWN = 6;

export const candidatePersonSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  initials: z.string(),
  /** Their picture, or null for somebody drawn as their initials. */
  avatarUrl: z.string().nullable(),
  email: z.string(),
  /** The teams they are in, by name, so adding one person is an informed act. */
  teams: z.array(z.string()),
});

export type CandidatePerson = z.infer<typeof candidatePersonSchema>;

export const candidateTeamSchema = z.object({
  teamId: z.string().uuid(),
  name: z.string(),
  /** How many people come with it, which is the whole question about a team. */
  memberCount: z.number().int().nonnegative(),
});

export type CandidateTeam = z.infer<typeof candidateTeamSchema>;

export const projectCandidatesViewSchema = z.object({
  people: z.array(candidatePersonSchema),
  teams: z.array(candidateTeamSchema),
  /** Matched but not drawn, so the picker can say to keep typing. */
  morePeople: z.number().int().nonnegative(),
  moreTeams: z.number().int().nonnegative(),
});

export type ProjectCandidatesView = z.infer<typeof projectCandidatesViewSchema>;

/**
 * Who and what is left to put on a project.
 *
 * Its own query rather than `identity.people` with another filter, because the
 * two answer to different permissions and have to. Reading the install's people
 * is `user.view`, which is the keys to the whole thing; putting somebody on a
 * project is `member.invite`, which a lead has. A producer who may staff their
 * own project would otherwise have a picker with nobody in it.
 *
 * It says a name, an email and which teams somebody is in — enough to tell two
 * Sams apart — and nothing else about them. Narrowed by the server rather than
 * filtered in the browser: a thousand people minus the eight already on the
 * project is still a thousand people to send.
 */
export const projectCandidatesQuery = defineQuery(
  'projects.candidates',
  z.object({
    projectId: z.string().uuid(),
    /** Matches a person's name or email, or a team's name. */
    search: z.string().trim().max(120).optional(),
  }),
  projectCandidatesViewSchema,
);
