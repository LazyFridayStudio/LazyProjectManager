import {
  addProjectMemberCommand,
  addProjectTeamCommand,
  createCommandSuccess,
  removeProjectMemberCommand,
  removeProjectTeamCommand,
  type CommandSuccess,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import type { RequestActor } from '../../../cqrs/request-context.js';
import { ProjectArchivedError } from '../../../domain/index.js';
import { loadPersonOnInstall, loadTeam } from '../../teams/team-access.js';
import { authoriseWithinProject, loadProjectForWrite } from '../project-access.js';

/**
 * What being put on a project is written as, until the column goes.
 *
 * `project_member.role` predates permission groups, and `reachedLevel` still
 * reads it: `viewer` reaches the project to read, everything else to write.
 * Nothing here offers a choice of it. Being on a project is reach and nothing
 * else — what somebody may do once they are there is what their teams' groups
 * and their own say — so everybody put on one is written at the value that
 * means "on it, fully", and the question is never asked on a screen.
 *
 * The column goes with the role ladder in #154. Until then this is the only
 * place in the product that writes it, which is what makes it one line to
 * delete rather than a search.
 */
const ON_THE_PROJECT = 'member';

interface MemberInput {
  commandId: string;
  projectId: string;
  userId: string;
}

/**
 * Puts somebody on a project.
 *
 * The command `member.invite` was written for and nothing implemented until
 * now. Being on a project is what says *where* somebody works — a permission
 * group says *what* they may do — so before this a person who was not an owner
 * or a lead could hold every group on the install and still open nothing.
 *
 * Already on it is not a failure: two producers pressing the same button is the
 * same outcome either way.
 */
export const addProjectMemberHandler = defineCommandHandler({
  definition: addProjectMemberCommand,

  async execute(input: MemberInput, context): Promise<CommandSuccess> {
    const actor = await authoriseWithinProject({
      context,
      handlerName: addProjectMemberCommand.name,
      projectId: input.projectId,
      action: 'member.invite',
    });

    const outcome = await executeCommand({
      database: context.database,
      commandName: addProjectMemberCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const project = await loadLiveProject(transaction, actor, input.projectId);
        const person = await loadPersonOnInstall(transaction.database, actor, input.userId);

        await transaction.database
          .insertInto('projectMember')
          .values({ projectId: project.id, userId: person.userId, role: ON_THE_PROJECT })
          // Leaving whatever they are already on it as. Somebody who has been
          // on the project since it was made is its `owner`, and a second press
          // of Add is not the thing that should take that off them.
          .onConflict((conflict) => conflict.doNothing())
          .execute();

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'project',
          aggregateId: project.id,
          name: 'projects.memberAdded',
          payload: { displayName: person.displayName },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.projectId) : createCommandSuccess();
  },
});

/**
 * Takes somebody off a project, and off nothing else.
 *
 * Not binned. A membership is a statement about who is working on what rather
 * than a thing somebody made, and putting one back is the same press that made
 * it — a bin full of these would be a bin nobody reads.
 */
export const removeProjectMemberHandler = defineCommandHandler({
  definition: removeProjectMemberCommand,

  async execute(input: MemberInput, context): Promise<CommandSuccess> {
    const actor = await authoriseWithinProject({
      context,
      handlerName: removeProjectMemberCommand.name,
      projectId: input.projectId,
      action: 'member.remove',
    });

    const outcome = await executeCommand({
      database: context.database,
      commandName: removeProjectMemberCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const project = await loadLiveProject(transaction, actor, input.projectId);
        const person = await loadPersonOnInstall(transaction.database, actor, input.userId);

        await transaction.database
          .deleteFrom('projectMember')
          .where('projectId', '=', project.id)
          .where('userId', '=', person.userId)
          .execute();

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'project',
          aggregateId: project.id,
          name: 'projects.memberRemoved',
          payload: { displayName: person.displayName },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.projectId) : createCommandSuccess();
  },
});

interface TeamInput {
  commandId: string;
  projectId: string;
  teamId: string;
}

/**
 * Puts a team on a project.
 *
 * A standing grant: everybody in the team reaches the project for as long as
 * they are in it. One row rather than one per person, so somebody who joins the
 * team in October is on the team's projects in October — which is the half that
 * expanding a team into memberships at the moment of the press gets wrong, and
 * gets wrong invisibly.
 *
 * The row says the team is on the project and nothing more. What its people may
 * do there is the permission groups the team already holds.
 */
export const addProjectTeamHandler = defineCommandHandler({
  definition: addProjectTeamCommand,

  async execute(input: TeamInput, context): Promise<CommandSuccess> {
    const actor = await authoriseWithinProject({
      context,
      handlerName: addProjectTeamCommand.name,
      projectId: input.projectId,
      action: 'member.invite',
    });

    const outcome = await executeCommand({
      database: context.database,
      commandName: addProjectTeamCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const project = await loadLiveProject(transaction, actor, input.projectId);
        const team = await loadTeam(transaction.database, actor, input.teamId);

        // Already on it is not a failure, as everywhere else a switch is
        // pressed twice by two people.
        await transaction.database
          .insertInto('projectTeam')
          .values({ projectId: project.id, teamId: team.teamId })
          .onConflict((conflict) => conflict.doNothing())
          .execute();

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'project',
          aggregateId: project.id,
          name: 'projects.teamAdded',
          payload: { name: team.name },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.projectId) : createCommandSuccess();
  },
});

/**
 * Takes a team off a project.
 *
 * Everybody who reached it only through that team stops reaching it, which is
 * the point of a standing grant. Anybody also on the project by name keeps
 * their own row, which is the point of the two being separate.
 */
export const removeProjectTeamHandler = defineCommandHandler({
  definition: removeProjectTeamCommand,

  async execute(input: TeamInput, context): Promise<CommandSuccess> {
    const actor = await authoriseWithinProject({
      context,
      handlerName: removeProjectTeamCommand.name,
      projectId: input.projectId,
      action: 'member.remove',
    });

    const outcome = await executeCommand({
      database: context.database,
      commandName: removeProjectTeamCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const project = await loadLiveProject(transaction, actor, input.projectId);
        const team = await loadTeam(transaction.database, actor, input.teamId);

        await transaction.database
          .deleteFrom('projectTeam')
          .where('projectId', '=', project.id)
          .where('teamId', '=', team.teamId)
          .execute();

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'project',
          aggregateId: project.id,
          name: 'projects.teamRemoved',
          payload: { name: team.name },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.projectId) : createCommandSuccess();
  },
});

/**
 * The project, insisted upon being one that is still being worked on.
 *
 * An archived project is off the launcher and nothing about it is being
 * changed — the same rule its settings form follows, and the same reason:
 * restoring it is the one press it still answers to.
 */
async function loadLiveProject(
  transaction: CommandTransaction,
  actor: RequestActor,
  projectId: string,
): Promise<{ readonly id: string; readonly name: string }> {
  const project = await loadProjectForWrite(transaction.database, actor, projectId);

  if (project.archivedAt !== null) {
    throw new ProjectArchivedError();
  }

  return project;
}
