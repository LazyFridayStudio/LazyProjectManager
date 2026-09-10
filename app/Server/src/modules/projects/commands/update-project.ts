import {
  createCommandSuccess,
  updateProjectCommand,
  type CommandSuccess,
  type ProjectPhase,
  type SwitchableProjectSection,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { assertProjectScheduleIsOrdered, ProjectArchivedError } from '../../../domain/index.js';
import {
  assertProjectPermission,
  loadMembershipRole,
  loadProjectForWrite,
  type WritableProject,
} from '../project-access.js';

interface UpdateProjectInput {
  commandId: string;
  projectId: string;
  name?: string;
  engine?: string | null;
  phase?: ProjectPhase;
  budgetMinor?: number | null;
  startsOn?: string | null;
  shipsOn?: string | null;
  datesTbd?: boolean;
  disabledSections?: SwitchableProjectSection[];
  syncOpenIssuesOnly?: boolean;
  syncEverySeconds?: number | null;
}

/** Only the fields that were sent are written. Everything else keeps its value. */
interface ProjectPatch {
  name?: string;
  engine?: string | null;
  phase?: ProjectPhase;
  budgetMinor?: number | null;
  startsOn?: string | null;
  shipsOn?: string | null;
  datesTbd?: boolean;
  /** Stored as the JSON the column holds, which is what the driver wants. */
  disabledSections?: string;
  syncOpenIssuesOnly?: boolean;
  syncEverySeconds?: number | null;
}

/**
 * Edits a project from its settings screen.
 *
 * The schedule is checked against the merged result rather than against the
 * fields that arrived, because moving only the ship date can still put it before
 * a start date that was already there.
 */
export const updateProjectHandler = defineCommandHandler({
  definition: updateProjectCommand,

  async execute(input: UpdateProjectInput, context): Promise<CommandSuccess> {
    const actor = requireActor(context, updateProjectCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'project.update' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: updateProjectCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => applyUpdate({ transaction, input, actor }),
    });

    return outcome.applied ? createCommandSuccess(input.projectId) : createCommandSuccess();
  },
});

interface UpdateProjectRequest {
  readonly transaction: CommandTransaction;
  readonly input: UpdateProjectInput;
  readonly actor: RequestActor;
}

async function applyUpdate(request: UpdateProjectRequest): Promise<void> {
  const { transaction, input, actor } = request;
  const project = await loadProjectForWrite(transaction.database, actor, input.projectId);

  if (project.archivedAt !== null) {
    throw new ProjectArchivedError();
  }

  const patch = buildPatch(input);
  const changedFields = Object.keys(patch);

  if (changedFields.length === 0) {
    return;
  }

  assertProjectScheduleIsOrdered(mergeSchedule(project, patch));

  await transaction.database
    .updateTable('project')
    .set({ ...patch, updatedAt: new Date() })
    .where('id', '=', project.id)
    .execute();

  transaction.appendEvent({
    accountId: actor.accountId,
    aggregateType: 'project',
    aggregateId: project.id,
    name: 'projects.projectUpdated',
    // The names of what moved, not the values: a budget is not something the
    // audit trail needs to repeat to everyone allowed to read it.
    payload: { changedFields },
  });
}

function buildPatch(input: UpdateProjectInput): ProjectPatch {
  const patch: ProjectPatch = {};

  if (input.name !== undefined) {
    patch.name = input.name;
  }

  if (input.engine !== undefined) {
    patch.engine = input.engine;
  }

  if (input.phase !== undefined) {
    patch.phase = input.phase;
  }

  if (input.budgetMinor !== undefined) {
    patch.budgetMinor = input.budgetMinor;
  }

  if (input.startsOn !== undefined) {
    patch.startsOn = input.startsOn;
  }

  if (input.shipsOn !== undefined) {
    patch.shipsOn = input.shipsOn;
  }

  if (input.datesTbd !== undefined) {
    patch.datesTbd = input.datesTbd;
  }

  if (input.disabledSections !== undefined) {
    /*
     * The set, not the words as they arrived. Two switches for the same section
     * would otherwise be two entries, and a section is off or it is not.
     */
    patch.disabledSections = JSON.stringify([...new Set(input.disabledSections)]);
  }

  if (input.syncOpenIssuesOnly !== undefined) {
    patch.syncOpenIssuesOnly = input.syncOpenIssuesOnly;
  }

  if (input.syncEverySeconds !== undefined) {
    patch.syncEverySeconds = input.syncEverySeconds;
  }

  return patch;
}

function mergeSchedule(
  project: WritableProject,
  patch: ProjectPatch,
): { startsOn: string | null; shipsOn: string | null } {
  return {
    startsOn: patch.startsOn === undefined ? project.startsOn : patch.startsOn,
    shipsOn: patch.shipsOn === undefined ? project.shipsOn : patch.shipsOn,
  };
}
