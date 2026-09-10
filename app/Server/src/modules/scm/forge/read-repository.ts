import type { Database } from '@lpm/database';
import type { ScmProvider } from '@lpm/shared';

import { InvariantViolatedError } from '../../../domain/index.js';
import type { Environment } from '../../../server/environment.js';
import { decryptSecret } from '../../../security/secret-box.js';
import { resolveApiBaseUrl } from './forge-endpoint.js';
import { GithubAppError, requestInstallationToken, type FetchLike } from './github-app.js';

/**
 * Asking a repository for something, rather than waiting to be told.
 *
 * Two screens do it now — the Builds page reads releases, the board reads
 * issues — and both need the same three steps first: find the connection,
 * establish it can read at all, and trade the app's key for a token. Written
 * once here, because the interesting part of either is what it does with the
 * answer, not the four requests it takes to be allowed to ask.
 */

export interface ReadableConnection {
  readonly id: string;
  readonly provider: ScmProvider;
  readonly repoFullName: string;
  readonly endpoint: string | null;
  readonly appId: string;
  readonly installationId: string;
  readonly privateKeyEnc: string;
  /** When the repository was first connected. What "since we connected" means. */
  readonly connectedAt: Date;
  /** When the board last reconciled with it, and null until it first has. */
  readonly issuesSyncedAt: Date | null;
}

/**
 * The connection, once it is established this project has one that can read.
 *
 * A repository can be connected for webhooks and still have no credential to
 * read with, which is the state every Gitea and GitLab connection is in today.
 * The two failures are told apart because a studio fixes them differently: one
 * needs a repository connected, the other needs an app installed on it.
 */
export async function loadReadableConnection(
  database: Database,
  projectId: string,
): Promise<ReadableConnection> {
  const connection = await database
    .selectFrom('scmConnection')
    .select([
      'id',
      'provider',
      'repoFullName',
      'endpoint',
      'appId',
      'installationId',
      'privateKeyEnc',
      'connectedAt',
      'issuesSyncedAt',
    ])
    .where('projectId', '=', projectId)
    .executeTakeFirst();

  if (connection === undefined) {
    throw new InvariantViolatedError(
      'This project has no repository connected. Connect one in the project settings first.',
    );
  }

  const { appId, installationId, privateKeyEnc } = connection;

  if (appId === null || installationId === null || privateKeyEnc === null) {
    throw new InvariantViolatedError(
      `${connection.repoFullName} is connected for events but has no app installed to read it with. Add one in the project settings.`,
    );
  }

  return { ...connection, appId, installationId, privateKeyEnc };
}

/**
 * What it takes to be allowed to ask: the key the connection's own is encrypted
 * with, and something to make the request with.
 *
 * Narrower than a request context on purpose — the worker has no request, and
 * this is the whole of what it would have to invent to pretend otherwise.
 */
export interface ForgeContext {
  readonly environment: Pick<Environment, 'APP_SECRET'>;
  readonly fetch: FetchLike;
}

/** Everything a request to the forge needs, once we are allowed to make one. */
export interface RepositoryReader {
  readonly token: string;
  readonly apiBaseUrl: string;
  readonly repoFullName: string;
  readonly fetchImpl: FetchLike;
}

/** Trades the app's key for a token, then does the asking. */
export async function readRepository<T>(
  connection: ReadableConnection,
  context: ForgeContext,
  read: (reader: RepositoryReader) => Promise<T>,
): Promise<T> {
  const reader = await openRepository(connection, context);

  return refusing(() => read(reader));
}

/**
 * Mints the token and hands back what a request needs.
 *
 * For work that cannot happen in one callback: a two-way sync reads, writes to
 * the database, and then writes back to the forge, and the database half has no
 * business being inside a network call.
 */
export async function openRepository(
  connection: ReadableConnection,
  context: ForgeContext,
): Promise<RepositoryReader> {
  const apiBaseUrl = resolveApiBaseUrl(connection.provider, connection.endpoint);

  return refusing(async () => {
    const token = await requestInstallationToken(
      {
        appId: connection.appId,
        installationId: connection.installationId,
        privateKey: decryptSecret(connection.privateKeyEnc, context.environment.APP_SECRET),
        apiBaseUrl,
      },
      new Date(),
      context.fetch,
    );

    return {
      token: token.token,
      apiBaseUrl,
      repoFullName: connection.repoFullName,
      fetchImpl: context.fetch,
    };
  });
}

/**
 * Turns a refusal from the forge into a refused command.
 *
 * `GithubAppError` already reads as something somebody can act on — an
 * installation that does not cover the repository, an app without permission to
 * do what was asked — and "something went wrong, the problem has been logged"
 * is the one answer that helps nobody.
 */
export async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof GithubAppError) {
      throw new InvariantViolatedError(error.message);
    }

    throw error;
  }
}
