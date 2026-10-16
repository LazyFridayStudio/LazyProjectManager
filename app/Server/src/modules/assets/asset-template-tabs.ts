import { sql } from '@lpm/database';
import { assetTemplateDefinitionSchema, type AssetTemplateDefinition } from '@lpm/shared';

import type { CommandTransaction } from '../../cqrs/execute-command.js';
import type { RequestActor } from '../../cqrs/request-context.js';
import { AssetTemplateNotFoundError, InvariantViolatedError } from '../../domain/index.js';
import type { WritableAsset } from './asset-access.js';
import { assertRoomForTabs } from './commands/asset-tabs.js';
import { placeAtEndOfSet } from './tab-positions.js';

/**
 * Turns a stored definition back into one.
 *
 * Read as `text` and parsed here: the `CamelCasePlugin` renames the keys of any
 * object it finds in a result, `jsonb` included. Checked against the schema on
 * the way out as well as on the way in, so a template written by an older build
 * that no longer fits is refused in words rather than half applied.
 */
export function readDefinition(stored: string): AssetTemplateDefinition {
  const parsed = assetTemplateDefinitionSchema.safeParse(JSON.parse(stored));

  if (!parsed.success) {
    throw new InvariantViolatedError('This template can no longer be read. Save it again.');
  }

  return parsed.data;
}

/** A template of this project, and what is in it. */
export async function loadTemplateOfProject(
  transaction: CommandTransaction,
  request: {
    readonly actor: RequestActor;
    readonly projectId: string;
    readonly templateId: string;
  },
): Promise<AssetTemplateDefinition> {
  const template = await transaction.database
    .selectFrom('assetTemplate')
    .select(sql<string>`definition::text`.as('definition'))
    .where('id', '=', request.templateId)
    .where('projectId', '=', request.projectId)
    .where('accountId', '=', request.actor.accountId)
    .executeTakeFirst();

  if (template === undefined) {
    // Also what a template from another project looks like: it would give this
    // asset tabs nobody on this project wrote.
    throw new AssetTemplateNotFoundError();
  }

  return readDefinition(template.definition);
}

/**
 * Gives an asset a template's tabs, after any it already has.
 *
 * Adds and never replaces: an asset halfway through has tabs with hours and
 * files on them. Nothing on the new tabs is ticked, nobody is on them and no
 * date is set, because a template is where the work starts.
 */
export async function addTabsFromTemplate(
  transaction: CommandTransaction,
  asset: WritableAsset,
  definition: AssetTemplateDefinition,
): Promise<void> {
  const database = transaction.database;

  await assertRoomForTabs(transaction, asset.id, definition.tabs.length);

  for (const tabDefinition of definition.tabs) {
    const tab = await database
      .insertInto('assetTab')
      .values({
        accountId: asset.accountId,
        assetId: asset.id,
        title: tabDefinition.title,
        position: await placeAtEndOfSet(database, {
          table: 'asset_tab',
          by: 'asset_id',
          id: asset.id,
        }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    for (const [index, blockDefinition] of tabDefinition.blocks.entries()) {
      const block = await database
        .insertInto('assetTabBlock')
        .values({
          assetId: asset.id,
          tabId: tab.id,
          kind: blockDefinition.kind,
          body: blockDefinition.kind === 'notes' ? blockDefinition.body : null,
          position: index + 1,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      if (blockDefinition.kind === 'checklist' && blockDefinition.items.length > 0) {
        await database
          .insertInto('assetTabChecklistItem')
          .values(
            blockDefinition.items.map((title, itemIndex) => ({
              assetId: asset.id,
              tabId: tab.id,
              blockId: block.id,
              title,
              position: itemIndex + 1,
            })),
          )
          .execute();
      }
    }
  }
}
