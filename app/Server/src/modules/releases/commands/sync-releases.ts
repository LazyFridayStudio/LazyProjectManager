import type { ScmProvider } from '@lpm/shared';
import { createCommandSuccess, syncReleasesCommand, type CommandSuccess } from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import {
  POSITION_STEP,
  ProjectArchivedError,
  ProjectNotFoundError,
} from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { loadReadableConnection, readRepository } from '../../scm/forge/read-repository.js';
import { fetchForgeReleases } from '../sync/fetch-releases.js';
import type { ForgeRelease } from '../sync/read-forge-releases.js';

/**
 * Reads the connected repository's releases in.
 *
 * Two rules do all the work here, and they are the reason a release knows where
 * it came from:
 *
 * A release somebody typed is never touched. Not refreshed, not renamed, not
 * deleted — a studio that wrote its own notes for a build keeps them, and a
 * sync that overwrote them would be the one action on this page that destroys
 * writing.
 *
 * A release the forge owns is whatever the forge now says it is. Notes edited
 * upstream arrive, a tag renamed upstream moves the row rather than doubling
 * it, and downloads that were deleted stop being listed.
 *
 * What the repository no longer has is left alone rather than deleted here. A
 * release pulled from GitHub last month and since removed there is still a
 * build somebody has, and quietly deleting the record of it is worse than
 * showing one that no longer has a download.
 */
export const syncReleasesHandler = defineCommandHandler({
  definition: syncReleasesCommand,

  async execute(input: { commandId: string; projectId: string }, context): Promise<CommandSuccess> {
    const actor = requireActor(context, syncReleasesCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'release.record' });

    /*
     * Read outside a transaction, so it is a plain query rather than
     * `loadProjectForWrite` — the forge call below has to happen before
     * anything is locked, and that helper exists to be used once inside.
     *
     * Scoped by account, so another account's project is not found rather than
     * forbidden: a "forbidden" tells somebody the id they guessed at was real.
     */
    const project = await context.database
      .selectFrom('project')
      .select(['id', 'archivedAt'])
      .where('id', '=', input.projectId)
      .where('accountId', '=', actor.accountId)
      .executeTakeFirst();

    if (project === undefined) {
      throw new ProjectNotFoundError();
    }

    if (project.archivedAt !== null) {
      throw new ProjectArchivedError();
    }

    const connection = await loadReadableConnection(context.database, project.id);

    /*
     * Read before the transaction opens.
     *
     * Somebody else's server is on the other end of this, and holding a
     * database transaction open across a call that can take seconds — or hang
     * until it times out — is how one slow forge becomes a table nobody else
     * can write to.
     */
    const found = await readRepository(connection, context, (reader) =>
      fetchForgeReleases({
        token: reader.token,
        apiBaseUrl: reader.apiBaseUrl,
        repoFullName: reader.repoFullName,
        fetchImpl: reader.fetchImpl,
      }),
    );

    await executeCommand({
      database: context.database,
      commandName: syncReleasesCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        await writeFoundReleases({
          transaction,
          actor,
          projectId: project.id,
          provider: connection.provider,
          found,
        });

        await transaction.database
          .updateTable('scmConnection')
          .set({ releasesSyncedAt: new Date() })
          .where('id', '=', connection.id)
          .execute();

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'project',
          aggregateId: project.id,
          name: 'releases.synced',
          payload: { projectId: project.id, found: found.length },
        });
      },
    });

    return createCommandSuccess(project.id);
  },
});

interface WriteRequest {
  readonly transaction: CommandTransaction;
  readonly actor: RequestActor;
  readonly projectId: string;
  readonly provider: ScmProvider;
  readonly found: readonly ForgeRelease[];
}

/** Each release the forge has, written in or refreshed. */
async function writeFoundReleases(request: WriteRequest): Promise<void> {
  const { transaction, projectId, provider } = request;

  // Every release already here, so each incoming one can be matched without a
  // query of its own — a hundred releases must not be a hundred round trips.
  const held = await transaction.database
    .selectFrom('projectRelease')
    .select(['id', 'tag', 'source', 'externalId'])
    .where('projectId', '=', projectId)
    .execute();

  const byExternalId = new Map(
    held
      .filter((release) => release.source === provider && release.externalId !== null)
      .map((release) => [release.externalId, release.id]),
  );

  const takenTags = new Set(held.map((release) => release.tag));
  const ownTags = new Set(
    held.filter((release) => byExternalId.has(release.externalId)).map((release) => release.tag),
  );

  for (const release of request.found) {
    const existingId = byExternalId.get(release.externalId);

    if (existingId !== undefined) {
      await refreshRelease({ ...request, releaseId: existingId, release });
      continue;
    }

    // A tag somebody typed by hand, or one another synced release already
    // holds. Left exactly as it is: what a person wrote wins over what a forge
    // says, and the tag is what makes a release findable.
    if (takenTags.has(release.tag) && !ownTags.has(release.tag)) {
      continue;
    }

    await addRelease({ ...request, release });
    takenTags.add(release.tag);
  }
}

interface OneReleaseRequest extends WriteRequest {
  readonly release: ForgeRelease;
}

async function addRelease(request: OneReleaseRequest): Promise<void> {
  const { transaction, actor, projectId, provider, release } = request;

  const created = await transaction.database
    .insertInto('projectRelease')
    .values({
      accountId: actor.accountId,
      projectId,
      source: provider,
      externalId: release.externalId,
      ...columnsOf(release),
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  await writeAssets({ transaction, actor, releaseId: created.id, release });
}

/**
 * A release the forge owns, made to say what the forge now says.
 *
 * The tag is written too, which is the point of matching on the id: a tag
 * corrected upstream corrects here rather than leaving the old one behind as a
 * second release nobody shipped.
 */
async function refreshRelease(
  request: OneReleaseRequest & { readonly releaseId: string },
): Promise<void> {
  const { transaction, actor, releaseId, release } = request;

  await transaction.database
    .updateTable('projectRelease')
    .set({ ...columnsOf(release), updatedAt: new Date() })
    .where('id', '=', releaseId)
    .execute();

  // Replaced rather than merged: a download deleted upstream should stop being
  // listed, and there is no local edit to a synced release worth preserving.
  await transaction.database
    .deleteFrom('releaseAsset')
    .where('releaseId', '=', releaseId)
    .execute();

  await writeAssets({ transaction, actor, releaseId, release });
}

/** The columns a forge release sets, which are the same on insert and update. */
function columnsOf(release: ForgeRelease): {
  tag: string;
  name: string;
  publishedOn: string;
  author: string;
  commitSha: string | null;
  isPrerelease: boolean;
  isDraft: boolean;
  notes: string;
  url: string | null;
} {
  return {
    tag: release.tag,
    name: release.name,
    publishedOn: release.publishedOn,
    author: release.author,
    commitSha: release.commitSha,
    isPrerelease: release.isPrerelease,
    isDraft: release.isDraft,
    notes: release.notes,
    url: release.url,
  };
}

/** The downloads a forge lists under one release. */
async function writeAssets(request: {
  readonly transaction: CommandTransaction;
  readonly actor: RequestActor;
  readonly releaseId: string;
  readonly release: ForgeRelease;
}): Promise<void> {
  const { transaction, actor, releaseId, release } = request;

  if (release.assets.length === 0) {
    return;
  }

  await transaction.database
    .insertInto('releaseAsset')
    .values(
      release.assets.map((asset, index) => ({
        accountId: actor.accountId,
        releaseId,
        name: asset.name,
        sizeBytes: asset.sizeBytes,
        downloadCount: asset.downloadCount,
        downloadUrl: asset.downloadUrl,
        position: (index + 1) * POSITION_STEP,
      })),
    )
    .execute();
}
