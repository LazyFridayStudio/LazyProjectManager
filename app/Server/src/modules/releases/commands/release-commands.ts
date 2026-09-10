import {
  createCommandSuccess,
  deleteReleaseCommand,
  recordReleaseCommand,
  updateReleaseCommand,
  type CommandSuccess,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import {
  POSITION_STEP,
  ProjectArchivedError,
  ReleaseNotFoundError,
  ReleaseTagTakenError,
} from '../../../domain/index.js';
import {
  assertProjectPermission,
  loadMembershipRole,
  loadProjectForWrite,
} from '../../projects/project-access.js';
import { binIt } from '../../recovery/index.js';

/** One downloadable file, as it arrives with the release it belongs to. */
interface AssetInput {
  name: string;
  sizeBytes?: number | null;
  downloadCount?: number;
  downloadUrl?: string | null;
}

/** The columns an update may set, which is every field but the downloads. */
interface ReleaseChange {
  tag?: string;
  name?: string;
  publishedOn?: string;
  author?: string;
  commitSha?: string | null;
  isPrerelease?: boolean;
  isDraft?: boolean;
  notes?: string;
  runLabel?: string | null;
  url?: string | null;
}

/** Everything a release can say about itself, as a command carries it. */
interface ReleaseFields {
  tag?: string;
  name?: string;
  publishedOn?: string;
  author?: string;
  commitSha?: string | null;
  isPrerelease?: boolean;
  isDraft?: boolean;
  notes?: string;
  runLabel?: string | null;
  url?: string | null;
  assets?: AssetInput[];
}

interface RecordInput extends ReleaseFields {
  commandId: string;
  projectId: string;
  tag: string;
  name: string;
  publishedOn: string;
  author: string;
}

/**
 * Records something the project shipped.
 *
 * `project.update` rather than a card permission: a release is a promise kept,
 * and anybody trusted with the ship date is trusted with these.
 */
export const recordReleaseHandler = defineCommandHandler({
  definition: recordReleaseCommand,

  async execute(input: RecordInput, context): Promise<CommandSuccess> {
    const actor = requireActor(context, recordReleaseCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'release.record' });

    let releaseId: string | undefined;

    const outcome = await executeCommand({
      database: context.database,
      commandName: recordReleaseCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const project = await loadProjectForWrite(transaction.database, actor, input.projectId);

        if (project.archivedAt !== null) {
          throw new ProjectArchivedError();
        }

        await assertTagIsFree({
          transaction,
          projectId: project.id,
          tag: input.tag,
          exceptId: null,
        });

        const created = await transaction.database
          .insertInto('projectRelease')
          .values({
            accountId: actor.accountId,
            projectId: project.id,
            tag: input.tag,
            name: input.name,
            publishedOn: input.publishedOn,
            author: input.author,
            commitSha: input.commitSha ?? null,
            isPrerelease: input.isPrerelease ?? false,
            isDraft: input.isDraft ?? false,
            notes: input.notes ?? '',
            runLabel: input.runLabel ?? null,
            url: input.url ?? null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        releaseId = created.id;

        await writeAssets({
          transaction,
          actor,
          releaseId: created.id,
          assets: input.assets ?? [],
        });

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'project',
          aggregateId: project.id,
          name: 'releases.recorded',
          payload: { projectId: project.id, releaseId: created.id, tag: input.tag },
        });
      },
    });

    return outcome.applied && releaseId !== undefined
      ? createCommandSuccess(releaseId)
      : createCommandSuccess();
  },
});

interface UpdateInput extends ReleaseFields {
  commandId: string;
  releaseId: string;
}

/**
 * Changes a release.
 *
 * An absent field means "leave it"; `assets` given replaces the list. A
 * download removed from a release is not a download with a flag on it.
 */
export const updateReleaseHandler = defineCommandHandler({
  definition: updateReleaseCommand,

  async execute(input: UpdateInput, context): Promise<CommandSuccess> {
    return writeRelease({
      context,
      commandId: input.commandId,
      commandName: updateReleaseCommand.name,
      run: async (write) => {
        const release = await loadReleaseForWrite(write, input.releaseId);

        if (input.tag !== undefined && input.tag !== release.tag) {
          await assertTagIsFree({
            transaction: write.transaction,
            projectId: release.projectId,
            tag: input.tag,
            exceptId: release.id,
          });
        }

        await write.transaction.database
          .updateTable('projectRelease')
          .set({ ...changedFields(input), updatedAt: new Date() })
          .where('id', '=', release.id)
          .execute();

        if (input.assets !== undefined) {
          await write.transaction.database
            .deleteFrom('releaseAsset')
            .where('releaseId', '=', release.id)
            .execute();

          await writeAssets({
            transaction: write.transaction,
            actor: write.actor,
            releaseId: release.id,
            assets: input.assets,
          });
        }

        return { projectId: release.projectId, id: release.id, event: 'releases.updated' };
      },
    });
  },
});

/** Takes a release off the page. The downloads listed under it go with it. */
export const deleteReleaseHandler = defineCommandHandler({
  definition: deleteReleaseCommand,

  async execute(input: { commandId: string; releaseId: string }, context): Promise<CommandSuccess> {
    return writeRelease({
      context,
      commandId: input.commandId,
      commandName: deleteReleaseCommand.name,
      run: async (write) => {
        const release = await loadReleaseForWrite(write, input.releaseId);

        await binIt({
          transaction: write.transaction,
          kind: 'projectRelease',
          accountId: write.actor.accountId,
          actorId: write.actor.userId,
          subjectId: release.id,
          projectId: release.projectId,
          name: release.tag,
        });

        // The assets go with it on the foreign key, which is where that rule
        // belongs: nothing here outlives the release it was published under.
        // The bin has them too, taken a moment ago, so they come back with it.
        await write.transaction.database
          .deleteFrom('projectRelease')
          .where('id', '=', release.id)
          .execute();

        return { projectId: release.projectId, id: release.id, event: 'releases.deleted' };
      },
    });
  },
});

/**
 * Only the fields the command actually carried.
 *
 * Kysely writes every key it is handed, so an absent field has to be absent
 * here too — a `set` built from the whole input would write null over the
 * commit of a release somebody only renamed.
 */
function changedFields(input: ReleaseFields): ReleaseChange {
  const changed: ReleaseChange = {};

  if (input.tag !== undefined) changed.tag = input.tag;
  if (input.name !== undefined) changed.name = input.name;
  if (input.publishedOn !== undefined) changed.publishedOn = input.publishedOn;
  if (input.author !== undefined) changed.author = input.author;
  if (input.commitSha !== undefined) changed.commitSha = input.commitSha;
  if (input.isPrerelease !== undefined) changed.isPrerelease = input.isPrerelease;
  if (input.isDraft !== undefined) changed.isDraft = input.isDraft;
  if (input.notes !== undefined) changed.notes = input.notes;
  if (input.runLabel !== undefined) changed.runLabel = input.runLabel;
  if (input.url !== undefined) changed.url = input.url;

  return changed;
}

/** The downloads of one release, in the order they were typed. */
async function writeAssets(request: {
  readonly transaction: CommandTransaction;
  readonly actor: RequestActor;
  readonly releaseId: string;
  readonly assets: readonly AssetInput[];
}): Promise<void> {
  const { transaction, actor, releaseId, assets } = request;

  if (assets.length === 0) {
    return;
  }

  await transaction.database
    .insertInto('releaseAsset')
    .values(
      assets.map((asset, index) => ({
        accountId: actor.accountId,
        releaseId,
        name: asset.name,
        sizeBytes: asset.sizeBytes ?? null,
        downloadCount: asset.downloadCount ?? 0,
        downloadUrl: asset.downloadUrl ?? null,
        // Spaced rather than 1, 2, 3, so one can later be dropped between two
        // without renumbering the rest.
        position: (index + 1) * POSITION_STEP,
      })),
    )
    .execute();
}

/**
 * One tag, one release.
 *
 * Checked in the transaction as well as by the unique constraint, so the person
 * gets a sentence rather than a database error — and checked at all because the
 * constraint's message names an index nobody outside this file has heard of.
 */
async function assertTagIsFree(request: {
  readonly transaction: CommandTransaction;
  readonly projectId: string;
  readonly tag: string;
  /** The release being changed, which is allowed to keep its own tag. */
  readonly exceptId: string | null;
}): Promise<void> {
  const { transaction, projectId, tag, exceptId } = request;

  let query = transaction.database
    .selectFrom('projectRelease')
    .select('id')
    .where('projectId', '=', projectId)
    .where('tag', '=', tag);

  if (exceptId !== null) {
    query = query.where('id', '!=', exceptId);
  }

  if ((await query.executeTakeFirst()) !== undefined) {
    throw new ReleaseTagTakenError(tag);
  }
}

interface Write {
  readonly transaction: CommandTransaction;
  readonly actor: RequestActor;
}

interface Written {
  readonly projectId: string;
  readonly id: string;
  readonly event: string;
}

/**
 * The two commands that change a release somebody names by id.
 *
 * They differ by their statements; the permission check, the transaction and
 * the event are the same three lines written once rather than twice.
 */
async function writeRelease(request: {
  readonly context: Parameters<Parameters<typeof defineCommandHandler>[0]['execute']>[1];
  readonly commandId: string;
  readonly commandName: string;
  readonly run: (write: Write) => Promise<Written>;
}): Promise<CommandSuccess> {
  const { context, commandId, commandName, run } = request;
  const actor = requireActor(context, commandName);
  const role = await loadMembershipRole(context.database, actor);

  assertProjectPermission({ actor, role, action: 'release.record' });

  let written: Written | undefined;

  const outcome = await executeCommand({
    database: context.database,
    commandName,
    commandId,
    actorId: actor.userId,
    run: async (transaction) => {
      written = await run({ transaction, actor });

      transaction.appendEvent({
        accountId: actor.accountId,
        aggregateType: 'project',
        aggregateId: written.projectId,
        name: written.event,
        payload: { projectId: written.projectId, releaseId: written.id },
      });
    },
  });

  return outcome.applied && written !== undefined
    ? createCommandSuccess(written.id)
    : createCommandSuccess();
}

/**
 * The release a command names, once it is established the caller may write it.
 *
 * Scoped by account before anything else: another account's release is not
 * found rather than forbidden, because a "forbidden" tells somebody the id they
 * guessed at was real.
 */
async function loadReleaseForWrite(
  write: Write,
  releaseId: string,
): Promise<{ id: string; projectId: string; tag: string }> {
  const release = await write.transaction.database
    .selectFrom('projectRelease')
    .select(['id', 'projectId', 'tag'])
    .where('id', '=', releaseId)
    .where('accountId', '=', write.actor.accountId)
    .executeTakeFirst();

  if (release === undefined) {
    throw new ReleaseNotFoundError();
  }

  const project = await loadProjectForWrite(
    write.transaction.database,
    write.actor,
    release.projectId,
  );

  if (project.archivedAt !== null) {
    throw new ProjectArchivedError();
  }

  return release;
}
