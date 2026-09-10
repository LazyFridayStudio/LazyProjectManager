import {
  createCommandSuccess,
  createMilestoneCommand,
  deleteMilestoneCommand,
  updateMilestoneCommand,
  type CommandSuccess,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import {
  MilestoneNotFoundError,
  MilestoneOutOfOrderError,
  ProjectArchivedError,
} from '../../../domain/index.js';
import {
  assertProjectPermission,
  loadMembershipRole,
  loadProjectForWrite,
} from '../../projects/project-access.js';
import { binIt } from '../../recovery/index.js';

interface CreateInput {
  commandId: string;
  projectId: string;
  name: string;
  goal?: string | null;
  startsOn: string;
  shipsOn: string;
  capacityPoints?: number | null;
}

/**
 * Adds a date the project is held to.
 *
 * `project.update` rather than a card permission: a milestone is a promise the
 * studio makes, and anybody trusted with the ship date is trusted with these.
 */
export const createMilestoneHandler = defineCommandHandler({
  definition: createMilestoneCommand,

  async execute(input: CreateInput, context): Promise<CommandSuccess> {
    const actor = requireActor(context, createMilestoneCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'milestone.manage' });

    let milestoneId: string | undefined;

    const outcome = await executeCommand({
      database: context.database,
      commandName: createMilestoneCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        milestoneId = await addMilestone({ transaction, input, actor });
      },
    });

    return outcome.applied && milestoneId !== undefined
      ? createCommandSuccess(milestoneId)
      : createCommandSuccess();
  },
});

interface AddRequest {
  readonly transaction: CommandTransaction;
  readonly input: CreateInput;
  readonly actor: RequestActor;
}

async function addMilestone({ transaction, input, actor }: AddRequest): Promise<string> {
  const project = await loadProjectForWrite(transaction.database, actor, input.projectId);

  if (project.archivedAt !== null) {
    throw new ProjectArchivedError();
  }

  assertOrdered(input.startsOn, input.shipsOn);

  const milestone = await transaction.database
    .insertInto('milestone')
    .values({
      accountId: actor.accountId,
      projectId: project.id,
      name: input.name,
      goal: input.goal ?? null,
      startsOn: input.startsOn,
      shipsOn: input.shipsOn,
      capacityPoints: input.capacityPoints ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  transaction.appendEvent({
    accountId: actor.accountId,
    aggregateType: 'project',
    aggregateId: project.id,
    name: 'milestones.created',
    payload: { projectId: project.id, milestoneId: milestone.id },
  });

  return milestone.id;
}

interface UpdateInput {
  commandId: string;
  milestoneId: string;
  name?: string;
  goal?: string | null;
  startsOn?: string;
  shipsOn?: string;
  capacityPoints?: number | null;
}

/**
 * Changes a milestone.
 *
 * The dates are checked against the merged result rather than against what
 * arrived, because moving only the end can still put it before a start that was
 * already there — the same reason the project's own schedule is checked that
 * way.
 */
export const updateMilestoneHandler = defineCommandHandler({
  definition: updateMilestoneCommand,

  async execute(input: UpdateInput, context): Promise<CommandSuccess> {
    const actor = requireActor(context, updateMilestoneCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'milestone.manage' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: updateMilestoneCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const milestone = await loadMilestone(transaction, actor, input.milestoneId);

        assertOrdered(input.startsOn ?? milestone.startsOn, input.shipsOn ?? milestone.shipsOn);

        const patch = {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.goal === undefined ? {} : { goal: input.goal }),
          ...(input.startsOn === undefined ? {} : { startsOn: input.startsOn }),
          ...(input.shipsOn === undefined ? {} : { shipsOn: input.shipsOn }),
          ...(input.capacityPoints === undefined ? {} : { capacityPoints: input.capacityPoints }),
        };

        if (Object.keys(patch).length === 0) return;

        await transaction.database
          .updateTable('milestone')
          .set({ ...patch, updatedAt: new Date() })
          .where('id', '=', milestone.id)
          .execute();

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'project',
          aggregateId: milestone.projectId,
          name: 'milestones.updated',
          payload: { projectId: milestone.projectId, milestoneId: milestone.id },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.milestoneId) : createCommandSuccess();
  },
});

/**
 * Takes a milestone out of the plan.
 *
 * The cards promised for it are unpromised rather than deleted — `on delete set
 * null` does that in the database. A date being dropped does not mean the work
 * was, and nobody has ever wanted the other behaviour.
 */
export const deleteMilestoneHandler = defineCommandHandler({
  definition: deleteMilestoneCommand,

  async execute(
    input: { commandId: string; milestoneId: string },
    context,
  ): Promise<CommandSuccess> {
    const actor = requireActor(context, deleteMilestoneCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'milestone.manage' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: deleteMilestoneCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const milestone = await loadMilestone(transaction, actor, input.milestoneId);
        const cards = await cardsHeldTo(transaction, milestone.id);

        await binIt({
          transaction,
          kind: 'milestone',
          accountId: actor.accountId,
          actorId: actor.userId,
          subjectId: milestone.id,
          projectId: milestone.projectId,
          name: milestone.name,
          about: `ships ${milestone.shipsOn}`,
          /*
           * The cards keep going; they just stop being promised for a date.
           * Putting the milestone back re-promises the ones nobody has since
           * moved to a different one.
           */
          repairs: cards.map((cardId) => ({
            table: 'card',
            id: cardId,
            column: 'milestone_id',
            was: milestone.id,
            now: null,
          })),
        });

        await transaction.database.deleteFrom('milestone').where('id', '=', milestone.id).execute();

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'project',
          aggregateId: milestone.projectId,
          name: 'milestones.deleted',
          payload: { projectId: milestone.projectId, milestoneId: milestone.id },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.milestoneId) : createCommandSuccess();
  },
});

async function loadMilestone(
  transaction: CommandTransaction,
  actor: RequestActor,
  milestoneId: string,
): Promise<{ id: string; projectId: string; name: string; startsOn: string; shipsOn: string }> {
  const milestone = await transaction.database
    .selectFrom('milestone')
    .select(['id', 'projectId', 'name', 'startsOn', 'shipsOn'])
    .where('id', '=', milestoneId)
    .where('accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (milestone === undefined) {
    // Also what another account's milestone looks like.
    throw new MilestoneNotFoundError();
  }

  const project = await loadProjectForWrite(transaction.database, actor, milestone.projectId);

  if (project.archivedAt !== null) {
    throw new ProjectArchivedError();
  }

  return milestone;
}

/** A milestone that ends before it starts is a typo, not a plan. */
function assertOrdered(startsOn: string, shipsOn: string): void {
  if (shipsOn < startsOn) {
    throw new MilestoneOutOfOrderError();
  }
}

/** The cards promised to it, which are about to stop being promised to anything. */
async function cardsHeldTo(
  transaction: CommandTransaction,
  milestoneId: string,
): Promise<string[]> {
  const rows = await transaction.database
    .selectFrom('card')
    .select('id')
    .where('milestoneId', '=', milestoneId)
    .execute();

  return rows.map((row) => row.id);
}
