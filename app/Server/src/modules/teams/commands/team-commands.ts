import {
  addTeamMemberCommand,
  createCommandSuccess,
  createTeamCommand,
  deleteTeamCommand,
  removeTeamMemberCommand,
  updateTeamCommand,
  type CommandSuccess,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import {
  requireActor,
  type RequestActor,
  type RequestContext,
} from '../../../cqrs/request-context.js';
import { ConflictError } from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { binIt, howMany } from '../../recovery/index.js';
import { loadPersonOnInstall, loadTeam } from '../team-access.js';

interface CreateTeamInput {
  commandId: string;
  name: string;
  leadUserId?: string | null;
}

/** Makes a team, with nobody in it and nothing reachable through it yet. */
export const createTeamHandler = defineCommandHandler({
  definition: createTeamCommand,

  async execute(input: CreateTeamInput, context): Promise<CommandSuccess> {
    const actor = await authoriseAdmin(context, createTeamCommand.name);

    const outcome = await executeCommand({
      database: context.database,
      commandName: createTeamCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        await assertNameIsFree(transaction, actor, { name: input.name, exceptTeamId: null });
        const leadUserId = await readLead(transaction, actor, input.leadUserId);

        const team = await transaction.database
          .insertInto('team')
          .values({ accountId: actor.accountId, name: input.name, leadUserId })
          .returning('id')
          .executeTakeFirstOrThrow();

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'team',
          aggregateId: team.id,
          name: 'teams.created',
          payload: { name: input.name },
        });

        return { teamId: team.id };
      },
    });

    return outcome.applied ? createCommandSuccess(outcome.result.teamId) : createCommandSuccess();
  },
});

interface UpdateTeamInput {
  commandId: string;
  teamId: string;
  name?: string;
  leadUserId?: string | null;
}

/** Renames a team, or changes who answers for it. */
export const updateTeamHandler = defineCommandHandler({
  definition: updateTeamCommand,

  async execute(input: UpdateTeamInput, context): Promise<CommandSuccess> {
    const actor = await authoriseAdmin(context, updateTeamCommand.name);

    const outcome = await executeCommand({
      database: context.database,
      commandName: updateTeamCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => updateTeam({ transaction, input, actor }),
    });

    return outcome.applied ? createCommandSuccess(input.teamId) : createCommandSuccess();
  },
});

async function updateTeam(request: {
  transaction: CommandTransaction;
  input: UpdateTeamInput;
  actor: RequestActor;
}): Promise<void> {
  const { transaction, input, actor } = request;
  const team = await loadTeam(transaction.database, actor, input.teamId);
  const patch: { name?: string; leadUserId?: string | null } = {};

  if (input.name !== undefined && input.name !== team.name) {
    await assertNameIsFree(transaction, actor, { name: input.name, exceptTeamId: team.teamId });
    patch.name = input.name;
  }

  if (input.leadUserId !== undefined) {
    patch.leadUserId = await readLead(transaction, actor, input.leadUserId);
  }

  const changedFields = Object.keys(patch);

  if (changedFields.length === 0) {
    return;
  }

  await transaction.database.updateTable('team').set(patch).where('id', '=', team.teamId).execute();

  transaction.appendEvent({
    accountId: actor.accountId,
    aggregateType: 'team',
    aggregateId: team.teamId,
    name: 'teams.updated',
    payload: { name: patch.name ?? team.name, changedFields },
  });
}

interface TeamInput {
  commandId: string;
  teamId: string;
}

/**
 * Takes a team off the install.
 *
 * The membership rows go with it — that is what the foreign key is for — and
 * the people do not. A team is a grouping, and deleting the group is not
 * deleting who was in it.
 */
export const deleteTeamHandler = defineCommandHandler({
  definition: deleteTeamCommand,

  async execute(input: TeamInput, context): Promise<CommandSuccess> {
    const actor = await authoriseAdmin(context, deleteTeamCommand.name);

    const outcome = await executeCommand({
      database: context.database,
      commandName: deleteTeamCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const team = await loadTeam(transaction.database, actor, input.teamId);
        const people = await countMembers(transaction, team.teamId);

        // Copied before it goes, in the same transaction: the rows have to
        // still be there to be kept, and a bin row for a delete that then
        // rolled back would offer to restore something that never went.
        await binIt({
          transaction,
          kind: 'team',
          accountId: actor.accountId,
          actorId: actor.userId,
          subjectId: team.teamId,
          name: team.name,
          about: howMany(people, 'person', 'people'),
        });

        await transaction.database.deleteFrom('team').where('id', '=', team.teamId).execute();

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'team',
          aggregateId: team.teamId,
          name: 'teams.deleted',
          payload: { name: team.name },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.teamId) : createCommandSuccess();
  },
});

interface TeamMemberInput {
  commandId: string;
  teamId: string;
  userId: string;
}

/** Puts somebody in a team. */
export const addTeamMemberHandler = defineCommandHandler({
  definition: addTeamMemberCommand,

  async execute(input: TeamMemberInput, context): Promise<CommandSuccess> {
    const actor = await authoriseAdmin(context, addTeamMemberCommand.name);

    const outcome = await executeCommand({
      database: context.database,
      commandName: addTeamMemberCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const team = await loadTeam(transaction.database, actor, input.teamId);
        const person = await loadPersonOnInstall(transaction.database, actor, input.userId);

        // Already in it is not a failure: two admins adding the same person is
        // the same outcome either way.
        await transaction.database
          .insertInto('teamMember')
          .values({ teamId: team.teamId, userId: person.userId })
          .onConflict((conflict) => conflict.columns(['teamId', 'userId']).doNothing())
          .execute();

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'team',
          aggregateId: team.teamId,
          name: 'teams.memberAdded',
          payload: { name: team.name, displayName: person.displayName },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.teamId) : createCommandSuccess();
  },
});

/** Takes somebody out of a team, and out of nothing else. */
export const removeTeamMemberHandler = defineCommandHandler({
  definition: removeTeamMemberCommand,

  async execute(input: TeamMemberInput, context): Promise<CommandSuccess> {
    const actor = await authoriseAdmin(context, removeTeamMemberCommand.name);

    const outcome = await executeCommand({
      database: context.database,
      commandName: removeTeamMemberCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const team = await loadTeam(transaction.database, actor, input.teamId);
        const person = await loadPersonOnInstall(transaction.database, actor, input.userId);

        await transaction.database
          .deleteFrom('teamMember')
          .where('teamId', '=', team.teamId)
          .where('userId', '=', person.userId)
          .execute();

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'team',
          aggregateId: team.teamId,
          name: 'teams.memberRemoved',
          payload: { name: team.name, displayName: person.displayName },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.teamId) : createCommandSuccess();
  },
});

/**
 * A lead has to be somebody on this install.
 *
 * Null passes through as null, which is a team nobody answers for — a real
 * state rather than a mistake.
 */
async function readLead(
  transaction: CommandTransaction,
  actor: RequestActor,
  leadUserId: string | null | undefined,
): Promise<string | null> {
  if (leadUserId === null || leadUserId === undefined) {
    return null;
  }

  const lead = await loadPersonOnInstall(transaction.database, actor, leadUserId);

  return lead.userId;
}

/**
 * Two teams called Audio is two teams nobody can tell apart on a grant.
 *
 * Checked here as well as by the unique index, so the message names the field
 * the admin is looking at rather than arriving as a database error.
 */
async function assertNameIsFree(
  transaction: CommandTransaction,
  actor: RequestActor,
  wanted: { readonly name: string; readonly exceptTeamId: string | null },
): Promise<void> {
  let query = transaction.database
    .selectFrom('team')
    .select('id')
    .where('accountId', '=', actor.accountId)
    .where((builder) => builder(builder.fn('lower', ['name']), '=', wanted.name.toLowerCase()));

  if (wanted.exceptTeamId !== null) {
    query = query.where('id', '!=', wanted.exceptTeamId);
  }

  if ((await query.executeTakeFirst()) !== undefined) {
    throw new ConflictError('There is already a team with that name.', {
      name: 'That name is taken.',
    });
  }
}

/** Every command here is an admin's, and they all ask the same question. */
async function authoriseAdmin(context: RequestContext, commandName: string): Promise<RequestActor> {
  const actor = requireActor(context, commandName);
  const role = await loadMembershipRole(context.database, actor);

  assertProjectPermission({ actor, role, action: 'team.manage' });

  return actor;
}

/** How many people were in it, for the line under its name in the bin. */
async function countMembers(transaction: CommandTransaction, teamId: string): Promise<number> {
  const counted = await transaction.database
    .selectFrom('teamMember')
    .select((builder) => builder.fn.countAll<string>().as('total'))
    .where('teamId', '=', teamId)
    .executeTakeFirstOrThrow();

  return Number(counted.total);
}
