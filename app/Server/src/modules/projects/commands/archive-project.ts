import {
  archiveProjectCommand,
  createCommandSuccess,
  restoreProjectCommand,
  type CommandSuccess,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import {
  requireActor,
  type RequestActor,
  type RequestContext,
} from '../../../cqrs/request-context.js';
import {
  assertProjectPermission,
  loadMembershipRole,
  loadProjectForWrite,
} from '../project-access.js';

interface ArchiveProjectInput {
  commandId: string;
  projectId: string;
}

/**
 * Takes a project off the launcher.
 *
 * Nothing is deleted, so every ticket key, asset and link still resolves. There
 * is no delete command for the same reason: no version of one leaves other
 * people's links working.
 */
export const archiveProjectHandler = defineCommandHandler({
  definition: archiveProjectCommand,

  execute: (input: ArchiveProjectInput, context) =>
    setArchived({ input, context, archived: true, commandName: archiveProjectCommand.name }),
});

/** Puts an archived project back on the launcher. */
export const restoreProjectHandler = defineCommandHandler({
  definition: restoreProjectCommand,

  execute: (input: ArchiveProjectInput, context) =>
    setArchived({ input, context, archived: false, commandName: restoreProjectCommand.name }),
});

interface SetArchivedRequest {
  readonly input: ArchiveProjectInput;
  readonly context: RequestContext;
  readonly archived: boolean;
  readonly commandName: string;
}

async function setArchived(request: SetArchivedRequest): Promise<CommandSuccess> {
  const { input, context, archived, commandName } = request;
  const actor = requireActor(context, commandName);
  const role = await loadMembershipRole(context.database, actor);

  assertProjectPermission({ actor, role, action: 'project.archive' });

  const outcome = await executeCommand({
    database: context.database,
    commandName,
    commandId: input.commandId,
    actorId: actor.userId,
    run: (transaction) => writeArchivedAt({ transaction, actor, input, archived }),
  });

  return outcome.applied ? createCommandSuccess(input.projectId) : createCommandSuccess();
}

interface WriteArchivedAtRequest {
  readonly transaction: CommandTransaction;
  readonly actor: RequestActor;
  readonly input: ArchiveProjectInput;
  readonly archived: boolean;
}

async function writeArchivedAt(request: WriteArchivedAtRequest): Promise<void> {
  const { transaction, actor, input, archived } = request;
  const project = await loadProjectForWrite(transaction.database, actor, input.projectId);

  // Archiving something already archived is the state the caller asked for.
  // Returning quietly beats an error for that.
  if (archived === (project.archivedAt !== null)) {
    return;
  }

  const now = new Date();

  await transaction.database
    .updateTable('project')
    .set({ archivedAt: archived ? now : null, updatedAt: now })
    .where('id', '=', project.id)
    .execute();

  transaction.appendEvent({
    accountId: actor.accountId,
    aggregateType: 'project',
    aggregateId: project.id,
    name: archived ? 'projects.projectArchived' : 'projects.projectRestored',
    payload: { code: project.code },
  });
}
