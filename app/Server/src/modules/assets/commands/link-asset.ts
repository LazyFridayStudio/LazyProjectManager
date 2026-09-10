import {
  createCommandSuccess,
  linkAssetCommand,
  unlinkAssetCommand,
  type CommandSuccess,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { AssetNotFoundError, CardNotFoundError } from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';

/** Named in `0011-card-asset-links`, and the only clash this insert expects. */
const LINK_UNIQUE_CONSTRAINT = 'card_asset_link_unique';

/**
 * Says a card is about an asset.
 *
 * Both have to be in the same project. A card in one project pointing at an
 * asset in another is a link nobody can follow from either end — the board it
 * came from cannot open the library it points at.
 *
 * Asking twice is not an error. Somebody pressing a button again because the
 * first press did not look like it worked should get the link they wanted, not a
 * message about the one they already have.
 */
export const linkAssetHandler = defineCommandHandler({
  definition: linkAssetCommand,

  async execute(
    input: { commandId: string; cardId: string; assetId: string },
    context,
  ): Promise<CommandSuccess> {
    const actor = requireActor(context, linkAssetCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.update' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: linkAssetCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => link({ transaction, input, actor }),
    });

    return outcome.applied ? createCommandSuccess(outcome.result) : createCommandSuccess();
  },
});

interface LinkRequest {
  readonly transaction: CommandTransaction;
  readonly input: { cardId: string; assetId: string };
  readonly actor: RequestActor;
}

async function link({ transaction, input, actor }: LinkRequest): Promise<string> {
  const card = await transaction.database
    .selectFrom('card')
    .select(['id', 'projectId'])
    .where('id', '=', input.cardId)
    .where('accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (card === undefined) {
    throw new CardNotFoundError();
  }

  // Scoped to the card's project, so an asset from elsewhere reads as one that
  // does not exist rather than as a link that cannot be followed.
  const asset = await transaction.database
    .selectFrom('asset')
    .select('id')
    .where('id', '=', input.assetId)
    .where('projectId', '=', card.projectId)
    .executeTakeFirst();

  if (asset === undefined) {
    throw new AssetNotFoundError();
  }

  // `do nothing` rather than catching the unique violation: a failed statement
  // aborts the transaction in Postgres, so there would be nothing left to ask
  // about the link that already exists.
  const created = await transaction.database
    .insertInto('cardAssetLink')
    .values({ accountId: actor.accountId, cardId: card.id, assetId: asset.id })
    .onConflict((conflict) => conflict.constraint(LINK_UNIQUE_CONSTRAINT).doNothing())
    .returning('id')
    .executeTakeFirst();

  if (created === undefined) {
    // Already linked, which is the state the caller asked for.
    const existing = await transaction.database
      .selectFrom('cardAssetLink')
      .select('id')
      .where('cardId', '=', card.id)
      .where('assetId', '=', asset.id)
      .executeTakeFirstOrThrow();

    return existing.id;
  }

  transaction.appendEvent({
    accountId: actor.accountId,
    aggregateType: 'card',
    aggregateId: card.id,
    name: 'assets.cardLinked',
    payload: { projectId: card.projectId, assetId: asset.id },
  });

  return created.id;
}

/**
 * Takes the link back.
 *
 * The card and the asset both stay where they are — this says they are no longer
 * about each other, not that either has gone.
 */
export const unlinkAssetHandler = defineCommandHandler({
  definition: unlinkAssetCommand,

  async execute(input: { commandId: string; linkId: string }, context): Promise<CommandSuccess> {
    const actor = requireActor(context, unlinkAssetCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.update' });

    await executeCommand({
      database: context.database,
      commandName: unlinkAssetCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const removed = await transaction.database
          .deleteFrom('cardAssetLink')
          .where('id', '=', input.linkId)
          .where('accountId', '=', actor.accountId)
          .returning(['cardId', 'assetId'])
          .executeTakeFirst();

        if (removed === undefined) {
          // Already gone, or never this account's. Either way the caller has
          // what they asked for.
          return;
        }

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'card',
          aggregateId: removed.cardId,
          name: 'assets.cardUnlinked',
          payload: { assetId: removed.assetId },
        });
      },
    });

    return createCommandSuccess(input.linkId);
  },
});
