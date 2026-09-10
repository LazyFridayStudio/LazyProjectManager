import {
  createCommandSuccess,
  tagAssetCommand,
  untagAssetCommand,
  MAXIMUM_TAGS_PER_ASSET,
  type CommandSuccess,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import {
  AssetNotFoundError,
  InvariantViolatedError,
  type MembershipRole,
} from '../../../domain/index.js';
import { loadWritableProject } from '../../board/cards/card-access.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';

interface TagRequest {
  readonly transaction: CommandTransaction;
  readonly input: { assetId: string; tag: string };
  readonly actor: RequestActor;
  readonly role: MembershipRole;
}

/**
 * The asset, and whether this caller may file it under anything.
 *
 * Reached through its project, so who may tag one is the rule that already
 * governs the asset rather than a second one written here.
 */
async function loadWritableAsset({ transaction, input, actor, role }: TagRequest) {
  const asset = await transaction.database
    .selectFrom('asset')
    .select(['id', 'projectId'])
    .where('id', '=', input.assetId)
    .where('accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (asset === undefined) {
    // Also what another account's asset looks like. Nobody learns one exists by
    // guessing at an id.
    throw new AssetNotFoundError();
  }

  const project = await loadWritableProject(
    { database: transaction.database, actor, role },
    asset.projectId,
  );

  return { ...asset, accountId: project.accountId };
}

/**
 * Files an asset under a word.
 *
 * Asking twice is not an error, the way linking a card twice is not: somebody
 * pressing a button again because the first press did not look like it worked
 * should end up with the tag they wanted rather than a message about the one
 * they already have.
 */
export const tagAssetHandler = defineCommandHandler({
  definition: tagAssetCommand,

  async execute(
    input: { commandId: string; assetId: string; tag: string },
    context,
  ): Promise<CommandSuccess> {
    const actor = requireActor(context, tagAssetCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.update' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: tagAssetCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => addTag({ transaction, input, actor, role }),
    });

    return outcome.applied ? createCommandSuccess(outcome.result) : createCommandSuccess();
  },
});

async function addTag(request: TagRequest): Promise<string> {
  const { transaction, input } = request;
  const asset = await loadWritableAsset(request);

  const alreadyOn = await transaction.database
    .selectFrom('assetTag')
    .select((builder) => builder.fn.countAll<string>().as('total'))
    .where('assetId', '=', asset.id)
    .executeTakeFirstOrThrow();

  if (Number(alreadyOn.total) >= MAXIMUM_TAGS_PER_ASSET) {
    throw new InvariantViolatedError(
      `An asset carries at most ${String(MAXIMUM_TAGS_PER_ASSET)} tags.`,
    );
  }

  // `on conflict do nothing` rather than catching the unique violation:
  // Postgres aborts a transaction on a failed statement, so catching one inside
  // this one would leave nothing else able to run.
  await transaction.database
    .insertInto('assetTag')
    .values({ accountId: asset.accountId, assetId: asset.id, tag: input.tag })
    .onConflict((conflict) => conflict.columns(['assetId', 'tag']).doNothing())
    .execute();

  transaction.appendEvent({
    accountId: asset.accountId,
    aggregateType: 'asset',
    aggregateId: asset.id,
    name: 'assets.tagged',
    // No tag in the payload: the outbox is read more widely than the asset, and
    // what a studio files its work under says what it is working on.
    payload: { projectId: asset.projectId },
  });

  return asset.id;
}

/** Takes the word off again. Asking for one that is not there is not an error. */
export const untagAssetHandler = defineCommandHandler({
  definition: untagAssetCommand,

  async execute(
    input: { commandId: string; assetId: string; tag: string },
    context,
  ): Promise<CommandSuccess> {
    const actor = requireActor(context, untagAssetCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.update' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: untagAssetCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => removeTag({ transaction, input, actor, role }),
    });

    return outcome.applied ? createCommandSuccess(outcome.result) : createCommandSuccess();
  },
});

async function removeTag(request: TagRequest): Promise<string> {
  const { transaction, input } = request;
  const asset = await loadWritableAsset(request);

  await transaction.database
    .deleteFrom('assetTag')
    .where('assetId', '=', asset.id)
    .where('tag', '=', input.tag)
    .execute();

  transaction.appendEvent({
    accountId: asset.accountId,
    aggregateType: 'asset',
    aggregateId: asset.id,
    name: 'assets.untagged',
    payload: { projectId: asset.projectId },
  });

  return asset.id;
}
