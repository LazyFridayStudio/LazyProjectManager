import { ASSET_STATUSES, type AssetStatus } from '@lpm/shared';

/**
 * The five stages an asset goes through, and what colour each one is.
 *
 * A studio reads its library by these: the dot on a tile, the dot beside a
 * filter, the bar on the dashboard. They were written out separately in each of
 * those places and had already drifted apart on `concept`, which is how a
 * library and the summary of that library end up disagreeing about what colour
 * a thing is. The statuses themselves are shared vocabulary — this file only
 * says what colour each one is, as `card-type-colors.ts` does for card types.
 */
export const assetStatuses = ASSET_STATUSES;

export type { AssetStatus };

export const colorByAssetStatus: Readonly<Record<AssetStatus, string>> = {
  /** Grey on purpose: nothing has happened to it yet. */
  concept: '#adadad',
  wip: '#f0de8a',
  review: '#63aeeb',
  approved: '#63eba3',
  final: '#eda363',
};

/**
 * Returns the colour for an asset status.
 *
 * Prefer this over reading `colorByAssetStatus` directly so the fallback for an
 * unrecognised status lives in exactly one place.
 */
export function getColorForAssetStatus(status: AssetStatus): string {
  return colorByAssetStatus[status];
}
