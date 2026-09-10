import { sql } from '@lpm/database';
import { cardSearchQuery, MAXIMUM_CARD_SUGGESTIONS, type CardSearchView } from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { requireActor } from '../../../cqrs/request-context.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { loadReadableProject } from '../cards/card-access.js';

/**
 * Cards and assets to link to, as somebody types a key.
 *
 * Keys first and in key order, because that is what was being typed; names
 * after, for when the key is half-remembered. Closed cards are included and
 * marked — linking to something already finished is a normal thing to want.
 *
 * Two statements rather than a union: they are different shapes with different
 * orderings, and a `union all` that made them the same shape would only be
 * pulled apart again on the way out.
 */
export const searchCardsHandler = defineQueryHandler({
  definition: cardSearchQuery,

  async execute(params: { projectId: string; query: string }, context): Promise<CardSearchView> {
    const actor = requireActor(context, cardSearchQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'card.view' });

    // Reuses the write path's project check, which is the same question: may
    // this person reach this project at all.
    const project = await loadReadableProject(
      { database: context.database, actor, role },
      params.projectId,
    );

    const pattern = `%${params.query}%`;

    const cards = await context.database
      .selectFrom('card')
      .select(['id', 'cardKey', 'title', 'type', 'closedAt'])
      .where('projectId', '=', project.projectId)
      .where((expression) =>
        expression.or([
          expression(sql`card_key`, 'ilike', pattern),
          expression(sql`title`, 'ilike', pattern),
        ]),
      )
      // A key match is what was being typed, so it comes first.
      .orderBy(sql`case when card_key ilike ${pattern} then 0 else 1 end`)
      .orderBy('cardKey')
      .limit(MAXIMUM_CARD_SUGGESTIONS)
      .execute();

    const assets = await context.database
      .selectFrom('asset')
      .innerJoin('assetCategory', 'assetCategory.id', 'asset.categoryId')
      .select([
        'asset.id as id',
        'asset.assetKey as assetKey',
        'asset.name as name',
        'asset.status as status',
        'assetCategory.name as categoryName',
      ])
      .where('asset.projectId', '=', project.projectId)
      .where((expression) =>
        expression.or([
          expression(sql`asset.asset_key`, 'ilike', pattern),
          expression(sql`asset.name`, 'ilike', pattern),
        ]),
      )
      .orderBy(sql`case when asset.asset_key ilike ${pattern} then 0 else 1 end`)
      .orderBy('asset.name')
      .limit(MAXIMUM_CARD_SUGGESTIONS)
      .execute();

    return {
      cards: cards.map((card) => ({
        id: card.id,
        cardKey: card.cardKey,
        title: card.title,
        type: card.type,
        closed: card.closedAt !== null,
      })),
      assets,
    };
  },
});
