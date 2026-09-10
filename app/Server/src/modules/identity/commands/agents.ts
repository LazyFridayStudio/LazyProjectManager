import {
  createAgentCommand,
  createCommandSuccess,
  createSecretSuccess,
  issueAgentTokenCommand,
  revokeAgentTokenCommand,
  updateAgentCommand,
  type CommandSuccess,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestContext } from '../../../cqrs/request-context.js';
import { deriveInitials, type PermittedAction } from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { assertIsAnAgent } from '../is-an-agent.js';
import { issueApiToken } from '../sessions/api-token-store.js';

/**
 * A password nothing can ever match.
 *
 * An agent does not sign in, so it has no password — but the column is not
 * null, and leaving it empty would make the hash comparison the only thing
 * standing between an agent and a sign-in with a blank password. A string that
 * is not a valid hash can never verify against anything.
 */
const NO_PASSWORD = 'agent — no password, and no way to sign in';

/**
 * What an agent can do before anybody gives it a permission group: read.
 *
 * Fixed rather than chosen. What somebody may do is decided by the permission
 * groups they hold, and offering a second way to answer that question would
 * give a studio two answers that disagree the first time one of them is used.
 * The lowest rung on the ladder is the one that grants least, so everything an
 * agent does beyond looking is something a person deliberately allowed.
 */
const AGENT_FLOOR = 'viewer' as const;

/**
 * Makes an agent.
 *
 * A user with no password and `kind = 'agent'`. It reaches the install by
 * presenting a key, and every line it writes in the trail carries its own name
 * — which is the whole reason it is a principal rather than a borrowed session.
 *
 * It is created holding **no permission groups at all**. Its role puts a floor
 * under what it can see and nothing else; anything beyond that is given
 * deliberately on the permissions screen. Something that could do everything
 * the moment it existed would be a thing somebody had to remember to narrow,
 * and that is not a safe default for a thing that acts on its own.
 *
 * The email is derived and unusable on purpose: it satisfies the unique index
 * without ever being an address anybody could send a reset to.
 */
export const createAgentHandler = defineCommandHandler({
  definition: createAgentCommand,

  async execute(
    input: { commandId: string; displayName: string; initials?: string },
    context,
  ): Promise<CommandSuccess> {
    const actor = await authorise(context, createAgentCommand.name, 'agent.create');

    const outcome = await executeCommand({
      database: context.database,
      commandName: createAgentCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const agent = await transaction.database
          .insertInto('appUser')
          .values({
            email: `agent+${input.commandId}@agents.invalid`,
            passwordHash: NO_PASSWORD,
            displayName: input.displayName,
            initials: input.initials ?? deriveInitials(input.displayName),
            status: 'active',
            kind: 'agent',
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        await transaction.database
          .insertInto('membership')
          .values({ accountId: actor.accountId, userId: agent.id, role: AGENT_FLOOR })
          .execute();

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'user',
          aggregateId: agent.id,
          name: 'identity.agentCreated',
          payload: { displayName: input.displayName },
        });

        return agent.id;
      },
    });

    return outcome.applied ? createCommandSuccess(outcome.result) : createCommandSuccess();
  },
});

/**
 * Changes an agent's name or the letters drawn in place of a picture.
 *
 * Only what was sent, and only for an agent: this is not a way to rename a
 * colleague, which is theirs to do on their own account window.
 */
export const updateAgentHandler = defineCommandHandler({
  definition: updateAgentCommand,

  async execute(
    input: { commandId: string; userId: string; displayName?: string; initials?: string },
    context,
  ): Promise<CommandSuccess> {
    const actor = await authorise(context, updateAgentCommand.name, 'agent.update');

    await assertIsAnAgent(context.database, actor.accountId, input.userId);

    const patch: { displayName?: string; initials?: string } = {};

    if (input.displayName !== undefined) patch.displayName = input.displayName;
    if (input.initials !== undefined) patch.initials = input.initials;

    if (Object.keys(patch).length === 0) {
      return createCommandSuccess(input.userId);
    }

    const outcome = await executeCommand({
      database: context.database,
      commandName: updateAgentCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        await transaction.database
          .updateTable('appUser')
          .set(patch)
          .where('id', '=', input.userId)
          .execute();

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'user',
          aggregateId: input.userId,
          name: 'identity.agentUpdated',
          payload: { changedFields: Object.keys(patch) },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.userId) : createCommandSuccess();
  },
});

/**
 * Issues a key for an agent.
 *
 * The secret comes back in the reply and is never readable again. It is the one
 * moment it exists in a form anybody can copy, which the screen says out loud.
 *
 * Only for an agent. A key that could act as a person would be a way around
 * the password on that person's account, and around the audit trail's answer to
 * "who did this".
 */
export const issueAgentTokenHandler = defineCommandHandler({
  definition: issueAgentTokenCommand,

  async execute(
    input: { commandId: string; userId: string; name: string },
    context,
  ): Promise<CommandSuccess> {
    const actor = await authorise(context, issueAgentTokenCommand.name, 'agent.issueKey');

    await assertIsAnAgent(context.database, actor.accountId, input.userId);

    const outcome = await executeCommand({
      database: context.database,
      commandName: issueAgentTokenCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const issued = await issueApiToken(transaction.database, input.userId, input.name);

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'user',
          aggregateId: input.userId,
          name: 'identity.agentTokenIssued',
          // The name of the key, never the key.
          payload: { tokenId: issued.id, name: input.name },
        });

        return issued;
      },
    });

    /*
     * The secret rides back in the reply, and only this once.
     *
     * A command returns identifiers and nothing else, which is the rule
     * everywhere. This is the narrow exception `secret` exists for: the key
     * cannot be fetched afterwards because nothing stores it, so the reply is
     * the only place it will ever be readable.
     *
     * A replayed command returns nothing rather than the secret again. The
     * reply to a retry is not a second chance to read a key.
     */
    return outcome.applied
      ? createSecretSuccess(outcome.result.id, outcome.result.token)
      : createCommandSuccess();
  },
});

/**
 * Stops a key working, immediately and for good.
 *
 * The row stays, marked revoked, so a list still says what was there and when
 * it stopped. A key that vanished would leave somebody wondering whether they
 * had revoked it or imagined it.
 */
export const revokeAgentTokenHandler = defineCommandHandler({
  definition: revokeAgentTokenCommand,

  async execute(input: { commandId: string; tokenId: string }, context): Promise<CommandSuccess> {
    const actor = await authorise(context, revokeAgentTokenCommand.name, 'agent.revokeKey');

    const outcome = await executeCommand({
      database: context.database,
      commandName: revokeAgentTokenCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        await transaction.database
          .updateTable('apiToken')
          .set({ revokedAt: new Date() })
          .where('id', '=', input.tokenId)
          .where('revokedAt', 'is', null)
          .execute();

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'user',
          aggregateId: input.tokenId,
          name: 'identity.agentTokenRevoked',
          payload: { tokenId: input.tokenId },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.tokenId) : createCommandSuccess();
  },
});

/**
 * Whoever is asking, if they may do this particular thing to an agent.
 *
 * A different action per command rather than one for all of them, because they
 * are different decisions: making an agent, giving it a key and stopping a key
 * are not the same risk. The last is the one worth splitting hardest — somebody
 * should be able to shut a key off in a hurry without that meaning they can
 * also mint one.
 */
async function authorise(
  context: RequestContext,
  commandName: string,
  action: PermittedAction,
): Promise<ReturnType<typeof requireActor>> {
  const actor = requireActor(context, commandName);
  const role = await loadMembershipRole(context.database, actor);

  assertProjectPermission({ actor, role, action });

  return actor;
}
