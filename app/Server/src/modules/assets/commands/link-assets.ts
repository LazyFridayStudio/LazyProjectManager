import {
  createCommandSuccess,
  linkAssetsCommand,
  unlinkAssetsCommand,
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

/** Named in `0062-an-asset-can-be-linked-to-another`, and the only clash this insert expects. */
const LINK_UNIQUE_CONSTRAINT = 'asset_link_unique';

interface LinkRequest {
  readonly transaction: CommandTransaction;
  readonly input: { assetId: string; toAssetId: string };
  readonly actor: RequestActor;
  readonly role: MembershipRole;
}

/**
 * Says two assets go together.
 *
 * Both have to be in the same project. An asset in one library pointing at one
 * in another is a link nobody can follow from either end, so the other asset is
 * looked up inside this one's project and one from elsewhere reads as one that
 * does not exist.
 *
 * Asking twice is not an error, from either end. The pair is stored one way
 * round whatever order it was asked in, so linking the helm to the Hound after
 * linking the Hound to the helm finds the link that is already there.
 */
export const linkAssetsHandler = defineCommandHandler({
  definition: linkAssetsCommand,

  async execute(
    input: { commandId: string; assetId: string; toAssetId: string },
    context,
  ): Promise<CommandSuccess> {
    const actor = requireActor(context, linkAssetsCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.link' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: linkAssetsCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => link({ transaction, input, actor, role }),
    });

    return outcome.applied ? createCommandSuccess(outcome.result) : createCommandSuccess();
  },
});

async function link({ transaction, input, actor, role }: LinkRequest): Promise<string> {
  if (input.assetId === input.toAssetId) {
    throw new InvariantViolatedError('An asset cannot be linked to itself.');
  }

  const asset = await transaction.database
    .selectFrom('asset')
    .select(['id', 'projectId'])
    .where('id', '=', input.assetId)
    .where('accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (asset === undefined) {
    // Also what another account's asset looks like.
    throw new AssetNotFoundError();
  }

  // Whether they reach this project, and may write to it, as well as whether
  // they link assets at all.
  const project = await loadWritableProject(
    { database: transaction.database, actor, role },
    asset.projectId,
  );

  const other = await transaction.database
    .selectFrom('asset')
    .select('id')
    .where('id', '=', input.toAssetId)
    .where('projectId', '=', asset.projectId)
    .executeTakeFirst();

  if (other === undefined) {
    throw new AssetNotFoundError();
  }

  // The lower id first, which is the order `asset_link_ordered` insists on.
  // Comparing the strings agrees with Postgres comparing the uuids: both read
  // the same lowercase hex digits left to right.
  const [firstAssetId, secondAssetId] =
    asset.id < other.id ? [asset.id, other.id] : [other.id, asset.id];

  // `do nothing` rather than catching the unique violation: a failed statement
  // aborts the transaction in Postgres, so there would be nothing left to ask
  // about the link that already exists.
  const created = await transaction.database
    .insertInto('assetLink')
    .values({ accountId: project.accountId, firstAssetId, secondAssetId })
    .onConflict((conflict) => conflict.constraint(LINK_UNIQUE_CONSTRAINT).doNothing())
    .returning('id')
    .executeTakeFirst();

  if (created === undefined) {
    // Already linked, which is the state the caller asked for.
    const existing = await transaction.database
      .selectFrom('assetLink')
      .select('id')
      .where('firstAssetId', '=', firstAssetId)
      .where('secondAssetId', '=', secondAssetId)
      .executeTakeFirstOrThrow();

    return existing.id;
  }

  transaction.appendEvent({
    accountId: project.accountId,
    aggregateType: 'asset',
    aggregateId: asset.id,
    name: 'assets.assetLinked',
    payload: { projectId: asset.projectId, linkedAssetId: other.id },
  });

  return created.id;
}

/**
 * Takes the link back.
 *
 * Both assets stay exactly as they were — this says they no longer go together,
 * not that either has gone.
 */
export const unlinkAssetsHandler = defineCommandHandler({
  definition: unlinkAssetsCommand,

  async execute(input: { commandId: string; linkId: string }, context): Promise<CommandSuccess> {
    const actor = requireActor(context, unlinkAssetsCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.link' });

    await executeCommand({
      database: context.database,
      commandName: unlinkAssetsCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const found = await transaction.database
          .selectFrom('assetLink')
          .innerJoin('asset', 'asset.id', 'assetLink.firstAssetId')
          .select(['assetLink.id', 'assetLink.firstAssetId', 'assetLink.secondAssetId'])
          .select('asset.projectId')
          .where('assetLink.id', '=', input.linkId)
          .where('assetLink.accountId', '=', actor.accountId)
          .executeTakeFirst();

        if (found === undefined) {
          // Already gone, or never this account's. Either way the caller has
          // what they asked for.
          return;
        }

        // Reached through the project, so a link in a library somebody cannot
        // write to is refused the way its assets would be.
        const project = await loadWritableProject(
          { database: transaction.database, actor, role },
          found.projectId,
        );

        await transaction.database.deleteFrom('assetLink').where('id', '=', found.id).execute();

        transaction.appendEvent({
          accountId: project.accountId,
          aggregateType: 'asset',
          aggregateId: found.firstAssetId,
          name: 'assets.assetUnlinked',
          payload: { projectId: found.projectId, linkedAssetId: found.secondAssetId },
        });
      },
    });

    return createCommandSuccess(input.linkId);
  },
});
