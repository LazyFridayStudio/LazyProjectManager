import { describeAssetStatus, type AssetDetailView } from '@lpm/shared';
import { useState } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import { useLinkAssets, useUnlinkAssets } from '../../logic/assets/use-assets.js';
import { useDisplay } from '../ui/index.js';
import { AssetPicker } from './AssetPicker.js';
import styles from '../board/card-detail/CardActivity.module.css';

export interface AssetLinksProps {
  readonly asset: AssetDetailView;
  readonly projectSlug: string;
  /** Whether the project is open for writing and this person may link assets. */
  readonly canWrite: boolean;
  /** Opens a linked asset in place of this one. Absent where there is nowhere to. */
  readonly onOpenAsset?: (assetId: string) => void;
}

/**
 * The other assets this one goes with.
 *
 * A boss and what it drops, a set and its pieces: things filed under different
 * categories because they are different kinds of thing, that still belong
 * together. Linking from either end shows on both, so the helm says it comes
 * from the Voryoc Hound and the Hound lists the helm.
 *
 * Drawn the way a card's assets are, because it is the same idea from a
 * different side — a row for what it links to, and a picker for what it could.
 */
export function AssetLinks({
  asset,
  projectSlug,
  canWrite,
  onOpenAsset,
}: AssetLinksProps): React.JSX.Element | null {
  const [isPicking, setIsPicking] = useState(false);
  const display = useDisplay();
  const link = useLinkAssets();
  const unlink = useUnlinkAssets();

  const report = {
    onError: (error: Error) => {
      display.showError(describeFailure(error));
    },
  };

  // Nothing linked and no way to link: the heading would only say there is
  // nothing here, which the space it takes says better.
  if (asset.linkedAssets.length === 0 && !canWrite) {
    return null;
  }

  return (
    // Named, for the reason the card's list is: while somebody is linking, the
    // picker under it offers rows of the same shape, and what is already linked
    // has to be tellable from what could be.
    <section className={styles.section} aria-label="Linked assets">
      <h3 className={styles.heading}>
        Linked assets
        {canWrite && (
          <button
            type="button"
            className={styles.headingAction}
            onClick={() => {
              setIsPicking((picking) => !picking);
            }}
          >
            {isPicking ? 'Done' : '+ Link'}
          </button>
        )}
      </h3>

      {asset.linkedAssets.length > 0 && (
        <ul className={styles.tiles}>
          {asset.linkedAssets.map((linked) => (
            <li key={linked.linkId} className={styles.tile}>
              {onOpenAsset === undefined ? (
                <LinkedAssetSummary linked={linked} />
              ) : (
                <button
                  type="button"
                  className={styles.tileOpen}
                  onClick={() => {
                    onOpenAsset(linked.assetId);
                  }}
                >
                  <LinkedAssetSummary linked={linked} />
                </button>
              )}
              {canWrite && (
                <button
                  type="button"
                  className={styles.rowAction}
                  aria-label={`Unlink ${linked.name}`}
                  disabled={unlink.isPending}
                  onClick={() => {
                    unlink.mutate({ linkId: linked.linkId }, report);
                  }}
                >
                  Unlink
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isPicking && (
        <AssetPicker
          projectSlug={projectSlug}
          exclude={new Set([asset.id, ...asset.linkedAssets.map((linked) => linked.assetId)])}
          busy={link.isPending}
          onPick={(toAssetId) => {
            link.mutate({ assetId: asset.id, toAssetId }, report);
          }}
        />
      )}
    </section>
  );
}

function LinkedAssetSummary({
  linked,
}: {
  linked: AssetDetailView['linkedAssets'][number];
}): React.JSX.Element {
  return (
    <>
      {/* Named in full on hover, because both of these are whatever the studio
          typed and either can outrun its column. */}
      <span className={styles.linkKind} title={linked.category.name}>
        {linked.category.name}
      </span>
      <span className={styles.rowTitle} title={linked.name}>
        {linked.name}
      </span>
      <span className={styles.state}>{describeAssetStatus(linked.status)}</span>
    </>
  );
}
