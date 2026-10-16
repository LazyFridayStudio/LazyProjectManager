import { ASSET_PHASES, type AssetPhase } from '@lpm/shared';

/**
 * The three phases an asset goes through, and what colour each one is.
 *
 * A studio reads its library by these: the dot on a tile, the dot beside a
 * filter, the bar on the dashboard. Written out once so those places cannot
 * drift apart. The phases themselves are shared vocabulary — this file only
 * says what colour each one is, as `card-type-colors.ts` does for card types.
 */
export const assetPhases = ASSET_PHASES;

export type { AssetPhase };

export const colorByAssetPhase: Readonly<Record<AssetPhase, string>> = {
  /** Grey on purpose: nobody has started building it. */
  pre_dev: '#adadad',
  dev: '#f0de8a',
  production: '#63eba3',
};

/**
 * Returns the colour for an asset phase.
 *
 * Prefer this over reading `colorByAssetPhase` directly so the fallback for an
 * unrecognised phase lives in exactly one place.
 */
export function getColorForAssetPhase(phase: AssetPhase): string {
  return colorByAssetPhase[phase];
}
