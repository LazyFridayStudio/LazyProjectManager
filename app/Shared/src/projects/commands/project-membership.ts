import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';

const projectIdSchema = z.string().uuid();
const userIdSchema = z.string().uuid();
const teamIdSchema = z.string().uuid();

/**
 * Puts somebody on a project.
 *
 * What `member.invite` was written for. Being on a project is what says *where*
 * somebody works — a permission group says *what* they may do, and a person
 * holding every group on the install still opens nothing until one of these
 * rows exists for them.
 *
 * **A project and a person, and no third field.** No seat, no level, no role.
 * What they may do once they are on it is what their teams' groups and their
 * own say, and a level written here would be a third opinion about a question
 * two systems already answer — which is the shape `0035-no-team-grants` and
 * `0039-no-portfolios` were written to remove.
 *
 * Sending it again for somebody already on the project leaves them on it. Two
 * producers pressing the same button is the same outcome either way.
 */
export const addProjectMemberCommand = defineCommand(
  'projects.addMember',
  z.object({ projectId: projectIdSchema, userId: userIdSchema }),
);

/**
 * Takes somebody off a project.
 *
 * Off this project and nothing else: they keep their teams, their groups and
 * every other project they are on. Somebody who was only ever reached through a
 * team is not on it by name and cannot be taken off this way — the team comes
 * off instead, or they leave the team.
 */
export const removeProjectMemberCommand = defineCommand(
  'projects.removeMember',
  z.object({ projectId: projectIdSchema, userId: userIdSchema }),
);

/**
 * Puts a team on a project.
 *
 * A standing grant, not a bulk add: everybody in the team reaches the project
 * for as long as they are in it, and somebody who joins the team next month
 * joins the project with it. That is the half a one-off expansion into
 * per-person rows gets wrong, and it gets it wrong silently — the drift only
 * shows up as somebody who cannot open the board nobody can explain.
 *
 * A project and a team, and nothing else, for the reason `projects.addMember`
 * gives. The team already holds the groups that say what its people may do.
 */
export const addProjectTeamCommand = defineCommand(
  'projects.addTeam',
  z.object({ projectId: projectIdSchema, teamId: teamIdSchema }),
);

/**
 * Takes a team off a project.
 *
 * Everybody who reached it only through that team stops reaching it. Anybody
 * also on the project by name keeps the row of their own, which is the point of
 * the two being separate rows.
 */
export const removeProjectTeamCommand = defineCommand(
  'projects.removeTeam',
  z.object({ projectId: projectIdSchema, teamId: teamIdSchema }),
);
