import { sql, type DatabaseTransaction } from '@lpm/database';

import type { CommandTransaction } from '../../cqrs/execute-command.js';
import type { RequestActor } from '../../cqrs/request-context.js';
import { AssetNotFoundError, type MembershipRole } from '../../domain/index.js';
import { loadWritableProject } from '../board/cards/card-access.js';

/**
 * Who is asking to change something on an asset, inside the command doing it.
 *
 * Everything that hangs off an asset — a tab, a block, a checklist line — is
 * reached through the asset, and the asset through its project. So who may
 * change one is the rule that already governs the asset, asked once here rather
 * than written again by every command under it.
 */
export interface AssetAccess {
  readonly transaction: CommandTransaction;
  readonly actor: RequestActor;
  readonly role: MembershipRole;
}

export interface WritableAsset {
  readonly id: string;
  readonly assetKey: string;
  readonly projectId: string;
  readonly accountId: string;
}

/**
 * An asset somebody may change: in their account, on a project they reach for
 * writing, and not archived.
 */
export async function loadWritableAsset(
  access: AssetAccess,
  assetId: string,
): Promise<WritableAsset> {
  const asset = await access.transaction.database
    .selectFrom('asset')
    .select(['id', 'assetKey', 'projectId'])
    .where('id', '=', assetId)
    .where('accountId', '=', access.actor.accountId)
    .executeTakeFirst();

  if (asset === undefined) {
    // Also what another account's asset looks like. Nobody learns one exists by
    // guessing at an id.
    throw new AssetNotFoundError();
  }

  const project = await loadWritableProject(
    { database: access.transaction.database, actor: access.actor, role: access.role },
    asset.projectId,
  );

  return { ...asset, accountId: project.accountId };
}

/**
 * Says something happened to an asset, for the trail and for every screen
 * showing it.
 *
 * No titles and no text in the payload: the outbox is read more widely than the
 * asset, and what a studio has left to do on a thing says what it is working on.
 */
export function appendAssetEvent(
  transaction: CommandTransaction,
  asset: WritableAsset,
  name: string,
): void {
  transaction.appendEvent({
    accountId: asset.accountId,
    aggregateType: 'asset',
    aggregateId: asset.id,
    name,
    payload: { projectId: asset.projectId },
  });
}

/** `numeric` arrives from `pg` as a string, so every read goes through here. */
export function readPosition(value: string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * The tab a file or an hour says it is for belongs to the asset it is on.
 *
 * A tab of another asset would tag a file to a tab that never shows it, and an
 * hour to one whose asset does not count it.
 */
export async function assertTabIsOnAsset(
  database: DatabaseTransaction,
  assetTabId: string,
  assetId: string,
): Promise<void> {
  const tab = await database
    .selectFrom('assetTab')
    .select('id')
    .where('id', '=', assetTabId)
    .where('assetId', '=', assetId)
    .executeTakeFirst();

  if (tab === undefined) {
    throw new AssetNotFoundError();
  }
}

/**
 * Makes sure an asset's Overview shows a section, adding the block at the end
 * if it does not.
 *
 * For a link made from somewhere other than the asset itself: a card linked to
 * it from the board, or another asset linked to it from that asset's panel. The
 * link is about this asset too, and one it did not show would be one nobody
 * looking at the asset could find.
 */
export async function showOnTheOverview(
  database: DatabaseTransaction,
  assetId: string,
  kind: 'cards' | 'assets',
): Promise<void> {
  await sql`
    insert into asset_tab_block (asset_id, tab_id, kind, position)
    select ${assetId}, null, ${kind}, coalesce(max(shown.position), 0) + 1
    from asset_tab_block as shown
    where shown.asset_id = ${assetId} and shown.tab_id is null
    on conflict (asset_id, kind) where tab_id is null
    do nothing
  `.execute(database);
}
