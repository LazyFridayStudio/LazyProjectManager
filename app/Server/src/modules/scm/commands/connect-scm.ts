import {
  connectScmCommand,
  createCommandSuccess,
  disconnectScmCommand,
  type CommandSuccess,
  type ScmProvider,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { ProjectArchivedError } from '../../../domain/index.js';
import {
  assertProjectPermission,
  loadMembershipRole,
  loadProjectForWrite,
} from '../../projects/project-access.js';
import { encryptSecret } from '../../../security/secret-box.js';

interface ConnectScmInput {
  commandId: string;
  projectId: string;
  provider: ScmProvider;
  repoFullName: string;
  endpoint?: string | null;
  webhookSecret: string;
}

/**
 * Points a project at the repository its work lands in.
 *
 * Connecting again replaces what was there, which is how a secret is rotated —
 * the old one stops being accepted the moment the new one is stored, and there
 * is no window where both work.
 *
 * Deliveries already received are kept. They are the record of what the
 * repository said, and reconnecting is a change of credentials rather than a
 * statement that none of it happened.
 */
export const connectScmHandler = defineCommandHandler({
  definition: connectScmCommand,

  async execute(input: ConnectScmInput, context): Promise<CommandSuccess> {
    const actor = requireActor(context, connectScmCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'scm.connect' });

    // Encrypted before the transaction opens: a server with no key configured
    // should fail before it has written anything, not halfway through.
    const webhookSecretEnc = encryptSecret(input.webhookSecret, context.environment.APP_SECRET);

    const outcome = await executeCommand({
      database: context.database,
      commandName: connectScmCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => connect({ transaction, input, actor, webhookSecretEnc }),
    });

    return outcome.applied ? createCommandSuccess(outcome.result) : createCommandSuccess();
  },
});

interface ConnectRequest {
  readonly transaction: CommandTransaction;
  readonly input: ConnectScmInput;
  readonly actor: RequestActor;
  readonly webhookSecretEnc: string;
}

async function connect({
  transaction,
  input,
  actor,
  webhookSecretEnc,
}: ConnectRequest): Promise<string> {
  const project = await loadProjectForWrite(transaction.database, actor, input.projectId);

  if (project.archivedAt !== null) {
    throw new ProjectArchivedError();
  }

  const values = {
    accountId: actor.accountId,
    projectId: project.id,
    provider: input.provider,
    repoFullName: input.repoFullName,
    endpoint: input.endpoint ?? null,
    webhookSecretEnc,
    connectedBy: actor.userId,
  };

  const connection = await transaction.database
    .insertInto('scmConnection')
    .values(values)
    .onConflict((conflict) =>
      conflict.column('projectId').doUpdateSet({
        provider: values.provider,
        repoFullName: values.repoFullName,
        endpoint: values.endpoint,
        webhookSecretEnc: values.webhookSecretEnc,
        connectedBy: values.connectedBy,
      }),
    )
    .returning('id')
    .executeTakeFirstOrThrow();

  transaction.appendEvent({
    accountId: actor.accountId,
    aggregateType: 'project',
    aggregateId: project.id,
    name: 'scm.connected',
    // The secret is not in here. A domain event is a permanent record, and a
    // permanent record of a credential is a credential nobody can rotate away.
    payload: { provider: input.provider, repoFullName: input.repoFullName },
  });

  return connection.id;
}

/**
 * Forgets the repository.
 *
 * The deliveries go with it. They only mean anything alongside the connection
 * that explains which repository they came from, and keeping credentials-adjacent
 * history for a repository somebody has disconnected is not a favour to them.
 */
export const disconnectScmHandler = defineCommandHandler({
  definition: disconnectScmCommand,

  async execute(input: { commandId: string; projectId: string }, context): Promise<CommandSuccess> {
    const actor = requireActor(context, disconnectScmCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'scm.connect' });

    await executeCommand({
      database: context.database,
      commandName: disconnectScmCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const project = await loadProjectForWrite(transaction.database, actor, input.projectId);

        await transaction.database
          .deleteFrom('scmConnection')
          .where('projectId', '=', project.id)
          .where('accountId', '=', actor.accountId)
          .execute();

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'project',
          aggregateId: project.id,
          name: 'scm.disconnected',
          payload: {},
        });
      },
    });

    return createCommandSuccess(input.projectId);
  },
});
