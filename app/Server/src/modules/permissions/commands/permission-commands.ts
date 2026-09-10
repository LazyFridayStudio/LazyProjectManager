import {
  createCommandSuccess,
  orderTeamPermissionGroupsCommand,
  createPermissionGroupCommand,
  deletePermissionGroupCommand,
  renamePermissionGroupCommand,
  setPermissionRuleCommand,
  setTeamPermissionGroupCommand,
  setUserPermissionGroupCommand,
  type CommandSuccess,
  type PermissionEffect,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import {
  requireActor,
  type RequestActor,
  type RequestContext,
} from '../../../cqrs/request-context.js';
import {
  ConflictError,
  isRuleSubject,
  InvariantViolatedError,
  PermissionGroupNotFoundError,
  TeamNotFoundError,
  UserNotFoundError,
} from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { binIt, howMany } from '../../recovery/index.js';

/**
 * A new, empty group.
 *
 * Empty on purpose: a group with rules already in it would be this product
 * having an opinion about somebody else's studio, and the first thing anybody
 * would do is take them out again.
 */
export const createPermissionGroupHandler = defineCommandHandler({
  definition: createPermissionGroupCommand,

  async execute(input: { commandId: string; name: string }, context): Promise<CommandSuccess> {
    const actor = await authoriseAdmin(context, createPermissionGroupCommand.name);

    let groupId: string | undefined;

    const outcome = await executeCommand({
      database: context.database,
      commandName: createPermissionGroupCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        await assertNameIsFree({ transaction, actor, name: input.name, except: null });

        const group = await transaction.database
          .insertInto('permissionGroup')
          .values({ accountId: actor.accountId, name: input.name })
          .returning('id')
          .executeTakeFirstOrThrow();

        groupId = group.id;

        appendEvent({
          transaction,
          actor,
          name: 'permissions.groupCreated',
          payload: {
            groupId: group.id,
            name: input.name,
          },
        });
      },
    });

    return outcome.applied && groupId !== undefined
      ? createCommandSuccess(groupId)
      : createCommandSuccess();
  },
});

export const renamePermissionGroupHandler = defineCommandHandler({
  definition: renamePermissionGroupCommand,

  async execute(
    input: { commandId: string; groupId: string; name: string },
    context,
  ): Promise<CommandSuccess> {
    const actor = await authoriseAdmin(context, renamePermissionGroupCommand.name);

    const outcome = await executeCommand({
      database: context.database,
      commandName: renamePermissionGroupCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        await loadGroup(transaction, actor, input.groupId);
        await assertNameIsFree({ transaction, actor, name: input.name, except: input.groupId });

        await transaction.database
          .updateTable('permissionGroup')
          .set({ name: input.name, updatedAt: new Date() })
          .where('id', '=', input.groupId)
          .execute();

        appendEvent({
          transaction,
          actor,
          name: 'permissions.groupRenamed',
          payload: {
            groupId: input.groupId,
            name: input.name,
          },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.groupId) : createCommandSuccess();
  },
});

/**
 * Takes the group away, and with it every team's hold on it.
 *
 * The rules and the holds go on the foreign key, which is where that rule
 * belongs: nothing outlives the group it was written for.
 */
export const deletePermissionGroupHandler = defineCommandHandler({
  definition: deletePermissionGroupCommand,

  async execute(input: { commandId: string; groupId: string }, context): Promise<CommandSuccess> {
    const actor = await authoriseAdmin(context, deletePermissionGroupCommand.name);

    const outcome = await executeCommand({
      database: context.database,
      commandName: deletePermissionGroupCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const group = await loadGroup(transaction, actor, input.groupId);
        const rules = await countRules(transaction, group.id);

        await binIt({
          transaction,
          kind: 'permissionGroup',
          accountId: actor.accountId,
          actorId: actor.userId,
          subjectId: group.id,
          name: group.name,
          about: howMany(rules, 'rule', 'rules'),
        });

        await transaction.database
          .deleteFrom('permissionGroup')
          .where('id', '=', input.groupId)
          .execute();

        appendEvent({
          transaction,
          actor,
          name: 'permissions.groupDeleted',
          payload: { groupId: input.groupId },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.groupId) : createCommandSuccess();
  },
});

/**
 * What a group says about one action: allow, deny, or nothing.
 *
 * One command for all three because they are one question with three answers,
 * and a screen with a three-way switch should not have to know which of two
 * commands a change maps to.
 */
export const setPermissionRuleHandler = defineCommandHandler({
  definition: setPermissionRuleCommand,

  async execute(
    input: {
      commandId: string;
      groupId: string;
      subject: string;
      effect: PermissionEffect | null;
    },
    context,
  ): Promise<CommandSuccess> {
    const actor = await authoriseAdmin(context, setPermissionRuleCommand.name);

    // Checked here rather than in the schema: the list of actions lives in the
    // authorisation policy, and a rule naming something nothing checks is a
    // permission that silently does nothing.
    if (!isRuleSubject(input.subject)) {
      throw new InvariantViolatedError(`${input.subject} is not something a rule can be about.`);
    }

    const outcome = await executeCommand({
      database: context.database,
      commandName: setPermissionRuleCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        await loadGroup(transaction, actor, input.groupId);

        await transaction.database
          .deleteFrom('permissionRule')
          .where('groupId', '=', input.groupId)
          .where('action', '=', input.subject)
          .execute();

        if (input.effect !== null) {
          await transaction.database
            .insertInto('permissionRule')
            .values({
              accountId: actor.accountId,
              groupId: input.groupId,
              action: input.subject,
              effect: input.effect,
            })
            .execute();
        }

        appendEvent({
          transaction,
          actor,
          name: 'permissions.ruleSet',
          payload: {
            groupId: input.groupId,
            subject: input.subject,
            effect: input.effect,
          },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.groupId) : createCommandSuccess();
  },
});

/** Gives a group to a team, or takes it back. */
export const setTeamPermissionGroupHandler = defineCommandHandler({
  definition: setTeamPermissionGroupCommand,

  async execute(
    input: { commandId: string; teamId: string; groupId: string; held: boolean },
    context,
  ): Promise<CommandSuccess> {
    const actor = await authoriseAdmin(context, setTeamPermissionGroupCommand.name);

    const outcome = await executeCommand({
      database: context.database,
      commandName: setTeamPermissionGroupCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        await loadGroup(transaction, actor, input.groupId);
        await assertTeamExists(transaction, actor, input.teamId);

        if (input.held) {
          await transaction.database
            .insertInto('teamPermissionGroup')
            .values({
              accountId: actor.accountId,
              teamId: input.teamId,
              groupId: input.groupId,
              // At the end, where a new thing goes when nothing says otherwise.
              position: await nextPlaceInTheList(transaction, input.teamId),
            })
            // Asking twice leaves one. The screen is a switch, and a switch
            // pressed twice by two people should not be an error either time.
            .onConflict((conflict) => conflict.doNothing())
            .execute();
        } else {
          await transaction.database
            .deleteFrom('teamPermissionGroup')
            .where('teamId', '=', input.teamId)
            .where('groupId', '=', input.groupId)
            .execute();
        }

        appendEvent({
          transaction,
          actor,
          name: 'permissions.teamGroupSet',
          payload: {
            teamId: input.teamId,
            groupId: input.groupId,
            held: input.held,
          },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.groupId) : createCommandSuccess();
  },
});

/**
 * The group, scoped by account before anything else.
 *
 * Another account's group is not found rather than forbidden, because a
 * "forbidden" tells somebody the id they guessed at was real.
 */
async function loadGroup(
  transaction: CommandTransaction,
  actor: RequestActor,
  groupId: string,
): Promise<{ id: string; name: string }> {
  const group = await transaction.database
    .selectFrom('permissionGroup')
    .select(['id', 'name'])
    .where('id', '=', groupId)
    .where('accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (group === undefined) {
    throw new PermissionGroupNotFoundError();
  }

  return group;
}

async function assertTeamExists(
  transaction: CommandTransaction,
  actor: RequestActor,
  teamId: string,
): Promise<void> {
  const team = await transaction.database
    .selectFrom('team')
    .select('id')
    .where('id', '=', teamId)
    .where('accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (team === undefined) {
    throw new TeamNotFoundError();
  }
}

/** Puts a team's permissions in the order somebody dragged them into. */
export const orderTeamPermissionGroupsHandler = defineCommandHandler({
  definition: orderTeamPermissionGroupsCommand,

  async execute(
    input: { commandId: string; teamId: string; groupIds: readonly string[] },
    context,
  ): Promise<CommandSuccess> {
    const actor = await authoriseAdmin(context, orderTeamPermissionGroupsCommand.name);

    const outcome = await executeCommand({
      database: context.database,
      commandName: orderTeamPermissionGroupsCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        await assertTeamExists(transaction, actor, input.teamId);

        /*
         * Only what the team actually holds is placed, and a name it does not
         * hold is ignored rather than refused.
         *
         * The list arrives from a screen that was drawn a moment ago. Somebody
         * taking a group off the team in between should not turn a drag into an
         * error — the drag was about the ones that are left, and they are the
         * ones written.
         */
        await Promise.all(
          input.groupIds.map((groupId, index) =>
            transaction.database
              .updateTable('teamPermissionGroup')
              .set({ position: index + 1 })
              .where('teamId', '=', input.teamId)
              .where('groupId', '=', groupId)
              .execute(),
          ),
        );

        appendEvent({
          transaction,
          actor,
          name: 'permissions.teamGroupsOrdered',
          payload: { teamId: input.teamId, groupIds: input.groupIds },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.teamId) : createCommandSuccess();
  },
});

/** Gives a group to one person, or takes it back. */
export const setUserPermissionGroupHandler = defineCommandHandler({
  definition: setUserPermissionGroupCommand,

  async execute(
    input: { commandId: string; userId: string; groupId: string; held: boolean },
    context,
  ): Promise<CommandSuccess> {
    const actor = await authoriseAdmin(context, setUserPermissionGroupCommand.name);

    const outcome = await executeCommand({
      database: context.database,
      commandName: setUserPermissionGroupCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        await loadGroup(transaction, actor, input.groupId);
        await assertPersonExists(transaction, actor, input.userId);

        if (input.held) {
          await transaction.database
            .insertInto('userPermissionGroup')
            .values({
              accountId: actor.accountId,
              userId: input.userId,
              groupId: input.groupId,
            })
            // Asking twice leaves one, the same as a team's.
            .onConflict((conflict) => conflict.doNothing())
            .execute();
        } else {
          await transaction.database
            .deleteFrom('userPermissionGroup')
            .where('userId', '=', input.userId)
            .where('groupId', '=', input.groupId)
            .execute();
        }

        appendEvent({
          transaction,
          actor,
          name: 'permissions.userGroupSet',
          payload: {
            userId: input.userId,
            groupId: input.groupId,
            held: input.held,
          },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.groupId) : createCommandSuccess();
  },
});

/**
 * One past the last group this team holds.
 *
 * Read inside the same transaction as the insert that uses it, so two people
 * adding a permission at the same instant cannot both be handed the same place.
 * Two rows sharing a position would only draw in an arbitrary order, which is
 * worth avoiding and not worth a constraint.
 */
async function nextPlaceInTheList(
  transaction: CommandTransaction,
  teamId: string,
): Promise<number> {
  const last = await transaction.database
    .selectFrom('teamPermissionGroup')
    .select(({ fn }) => fn.max('position').as('highest'))
    .where('teamId', '=', teamId)
    .executeTakeFirst();

  return (last?.highest ?? 0) + 1;
}

/**
 * Somebody on this install, checked the way a team is.
 *
 * By account as well as by id, so a user id guessed from another install is
 * indistinguishable from one that does not exist.
 */
async function assertPersonExists(
  transaction: CommandTransaction,
  actor: RequestActor,
  userId: string,
): Promise<void> {
  const person = await transaction.database
    .selectFrom('membership')
    .select('userId')
    .where('userId', '=', userId)
    .where('accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (person === undefined) {
    throw new UserNotFoundError();
  }
}

/** Two groups with one name is two things nobody can tell apart on the screen. */
async function assertNameIsFree(request: {
  readonly transaction: CommandTransaction;
  readonly actor: RequestActor;
  readonly name: string;
  /** The group being renamed, which is allowed to keep the name it has. */
  readonly except: string | null;
}): Promise<void> {
  const { transaction, actor, name, except } = request;

  let query = transaction.database
    .selectFrom('permissionGroup')
    .select('id')
    .where('accountId', '=', actor.accountId)
    .where((builder) => builder.fn('lower', ['name']), '=', name.toLowerCase());

  if (except !== null) {
    query = query.where('id', '!=', except);
  }

  if ((await query.executeTakeFirst()) !== undefined) {
    throw new ConflictError('There is already a permission group with that name.', {
      name: 'That name is taken.',
    });
  }
}

function appendEvent(request: {
  readonly transaction: CommandTransaction;
  readonly actor: RequestActor;
  readonly name: string;
  readonly payload: Record<string, unknown>;
}): void {
  const { transaction, actor, name, payload } = request;

  transaction.appendEvent({
    accountId: actor.accountId,
    aggregateType: 'account',
    aggregateId: actor.accountId,
    name,
    payload,
  });
}

async function authoriseAdmin(context: RequestContext, commandName: string): Promise<RequestActor> {
  const actor = requireActor(context, commandName);
  const role = await loadMembershipRole(context.database, actor);

  assertProjectPermission({ actor, role, action: 'team.manage' });

  return actor;
}

/** How many rules it held, for the line under its name in the bin. */
async function countRules(transaction: CommandTransaction, groupId: string): Promise<number> {
  const counted = await transaction.database
    .selectFrom('permissionRule')
    .select((builder) => builder.fn.countAll<string>().as('total'))
    .where('groupId', '=', groupId)
    .executeTakeFirstOrThrow();

  return Number(counted.total);
}
