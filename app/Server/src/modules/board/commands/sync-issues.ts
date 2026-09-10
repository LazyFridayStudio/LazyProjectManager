import { createCommandSuccess, syncIssuesCommand, type CommandSuccess } from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { requireActor } from '../../../cqrs/request-context.js';
import { ProjectNotFoundError } from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { syncProjectIssues } from '../sync/sync-project-issues.js';

/**
 * Somebody pressing the button on the board.
 *
 * The work itself is in `syncProjectIssues`, because the worker does the same
 * thing every half hour and neither of them should be the copy that drifts.
 * What is here is what only a request has: who is asking, and whether they may.
 */
export const syncIssuesHandler = defineCommandHandler({
  definition: syncIssuesCommand,

  async execute(input: { commandId: string; projectId: string }, context): Promise<CommandSuccess> {
    const actor = requireActor(context, syncIssuesCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'card.create' });

    /*
     * Scoped by account before anything else happens, so another account's
     * project is not found rather than forbidden: a "forbidden" tells somebody
     * the id they guessed at was real.
     */
    const project = await context.database
      .selectFrom('project')
      .select('id')
      .where('id', '=', input.projectId)
      .where('accountId', '=', actor.accountId)
      .executeTakeFirst();

    if (project === undefined) {
      throw new ProjectNotFoundError();
    }

    await syncProjectIssues({
      database: context.database,
      environment: context.environment,
      fetch: context.fetch,
      projectId: project.id,
      actorId: actor.userId,
      commandId: input.commandId,
    });

    return createCommandSuccess(project.id);
  },
});
