import {
  connectScmAppCommand,
  createCommandSuccess,
  disconnectScmAppCommand,
  type CommandSuccess,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestContext } from '../../../cqrs/request-context.js';
import { InvariantViolatedError } from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { encryptSecret } from '../../../security/secret-box.js';
import { resolveApiBaseUrl } from '../forge/forge-endpoint.js';
import {
  assertRepositoryAccess,
  requestInstallationToken,
  GithubAppError,
  type FetchLike,
} from '../forge/github-app.js';

interface ConnectAppInput {
  commandId: string;
  projectId: string;
  appId: string;
  installationId: string;
  privateKey: string;
}

/**
 * Gives a connection credentials to read the repository.
 *
 * Checked against the forge before anything is written. Credentials that are
 * stored and then turn out not to work are credentials somebody has to go
 * looking for the day a card stops showing commits — and the person who pasted
 * them is right here, with the form still open and the key still on their
 * clipboard.
 *
 * Two checks, because they fail for different reasons a studio fixes
 * differently: the token proves the app id and the key, and reading the
 * repository proves the installation covers it.
 */
export const connectScmAppHandler = defineCommandHandler({
  definition: connectScmAppCommand,

  async execute(input: ConnectAppInput, context): Promise<CommandSuccess> {
    const actor = requireActor(context, connectScmAppCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'scm.connect' });

    const connection = await loadConnection(context, input.projectId, actor.accountId);

    if (connection.provider !== 'github') {
      // An App is a GitHub idea. A Gitea or GitLab install reads with a token,
      // which is a different form and a different thing to ask for.
      throw new InvariantViolatedError(
        'App credentials are a GitHub thing. This project is connected to a different forge.',
      );
    }

    const apiBaseUrl = resolveApiBaseUrl(connection.provider, connection.endpoint);

    await proveAccess({
      credentials: {
        appId: input.appId,
        installationId: input.installationId,
        privateKey: input.privateKey,
        apiBaseUrl,
      },
      repoFullName: connection.repoFullName,
      fetchImpl: context.fetch,
    });

    // Encrypted before the transaction opens, as the webhook secret is: a server
    // with no key configured should fail before it has written anything.
    const privateKeyEnc = encryptSecret(input.privateKey, context.environment.APP_SECRET);

    const outcome = await executeCommand({
      database: context.database,
      commandName: connectScmAppCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        await transaction.database
          .updateTable('scmConnection')
          .set({
            appId: input.appId,
            installationId: input.installationId,
            privateKeyEnc,
            accessCheckedAt: new Date(),
          })
          .where('id', '=', connection.id)
          .execute();

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'project',
          aggregateId: input.projectId,
          name: 'scm.appConnected',
          // No key and no ids: the outbox is read more widely than this screen.
          payload: { projectId: input.projectId },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(connection.id) : createCommandSuccess();
  },
});

/** Takes the credentials away, leaving the webhook exactly as it was. */
export const disconnectScmAppHandler = defineCommandHandler({
  definition: disconnectScmAppCommand,

  async execute(input: { commandId: string; projectId: string }, context): Promise<CommandSuccess> {
    const actor = requireActor(context, disconnectScmAppCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'scm.connect' });

    const connection = await loadConnection(context, input.projectId, actor.accountId);

    const outcome = await executeCommand({
      database: context.database,
      commandName: disconnectScmAppCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        // All four together: the database refuses a half-configured app, and
        // leaving a checked-at behind would claim something was verified.
        await transaction.database
          .updateTable('scmConnection')
          .set({
            appId: null,
            installationId: null,
            privateKeyEnc: null,
            accessCheckedAt: null,
          })
          .where('id', '=', connection.id)
          .execute();

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'project',
          aggregateId: input.projectId,
          name: 'scm.appDisconnected',
          payload: { projectId: input.projectId },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(connection.id) : createCommandSuccess();
  },
});

async function loadConnection(context: RequestContext, projectId: string, accountId: string) {
  const connection = await context.database
    .selectFrom('scmConnection')
    .select(['id', 'provider', 'repoFullName', 'endpoint'])
    .where('projectId', '=', projectId)
    .where('accountId', '=', accountId)
    .executeTakeFirst();

  if (connection === undefined) {
    // App credentials extend a connection rather than making one: there is
    // nothing to read from until a repository has been named.
    throw new InvariantViolatedError('Connect a repository before giving it credentials.');
  }

  return connection;
}

interface AccessCheck {
  readonly credentials: {
    readonly appId: string;
    readonly installationId: string;
    readonly privateKey: string;
    readonly apiBaseUrl: string;
  };
  readonly repoFullName: string;
  readonly fetchImpl: FetchLike;
}

/**
 * Asks the forge whether these credentials work, and turns a no into words.
 *
 * `GithubAppError` already reads as something somebody can act on — a wrong
 * key, an installation on the wrong repository — so it is passed straight
 * through as a refused command rather than becoming a five hundred.
 */
async function proveAccess({ credentials, repoFullName, fetchImpl }: AccessCheck): Promise<void> {
  try {
    const token = await requestInstallationToken(credentials, new Date(), fetchImpl);

    await assertRepositoryAccess(
      { token: token.token, apiBaseUrl: credentials.apiBaseUrl, repoFullName },
      fetchImpl,
    );
  } catch (error) {
    if (error instanceof GithubAppError) {
      throw new InvariantViolatedError(error.message);
    }

    throw error;
  }
}
