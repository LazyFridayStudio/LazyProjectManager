import { describeAssetStatus, type CardDetailView } from '@lpm/shared';
import { useState } from 'react';

import { useAssetLibrary, useLinkAsset, useUnlinkAsset } from '../../../logic/assets/use-assets.js';
import { joinClassNames } from '../../../lib/join-class-names.js';
import styles from './CardActivity.module.css';

export interface CardAssetsProps {
  readonly card: CardDetailView;
  readonly projectSlug: string;
  readonly canWrite: boolean;
  /** Opens the asset over whatever screen this card is on. */
  readonly onOpenAsset: (assetId: string) => void;
}

/**
 * The assets this card is about.
 *
 * A card is a piece of work; an asset is the thing the work is for. Saying which
 * is what turns a board and a library into one product rather than two screens
 * that happen to be in the same install.
 */
export function CardAssets({
  card,
  projectSlug,
  canWrite,
  onOpenAsset,
}: CardAssetsProps): React.JSX.Element | null {
  const [isPicking, setIsPicking] = useState(false);
  const unlink = useUnlinkAsset(projectSlug, card.id);

  // Nothing linked and no way to link: the heading would only say the card has
  // no assets, which the space it takes says better.
  if (card.assetLinks.length === 0 && !canWrite) {
    return null;
  }

  return (
    // Named, for the reason the clump is: while somebody is linking, the search
    // under it offers rows of the same shape — a category and an asset name —
    // and the list of what is already on the card has to be tellable from the
    // list of what could be.
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

      {card.assetLinks.length > 0 && (
        <ul className={styles.tiles}>
          {card.assetLinks.map((link) => (
            <li key={link.linkId} className={styles.tile}>
              <button
                type="button"
                className={styles.tileOpen}
                onClick={() => {
                  onOpenAsset(link.assetId);
                }}
              >
                {/* Named in full on hover, because both of these are whatever
                    the studio typed and either can outrun its column. */}
                <span className={styles.linkKind} title={link.categoryName}>
                  {link.categoryName}
                </span>
                <span className={styles.rowTitle} title={link.name}>
                  {link.name}
                </span>
                <span className={styles.state}>{describeAssetStatus(link.status)}</span>
              </button>
              {canWrite && (
                <button
                  type="button"
                  className={styles.rowAction}
                  onClick={() => {
                    unlink.mutate({ linkId: link.linkId });
                  }}
                >
                  Unlink
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isPicking && <AssetPicker card={card} projectSlug={projectSlug} />}
    </section>
  );
}

/**
 * What there is to link to.
 *
 * The library the project already has, filtered as somebody types. It is read
 * through the same query the asset screen uses rather than a search of its own —
 * a project's library is small enough to hold, and one endpoint fewer is one
 * fewer to keep in step.
 */
function AssetPicker({
  card,
  projectSlug,
}: {
  card: CardDetailView;
  projectSlug: string;
}): React.JSX.Element {
  const library = useAssetLibrary(projectSlug);
  const link = useLinkAsset(projectSlug, card.id);
  const [search, setSearch] = useState('');

  const linked = new Set(card.assetLinks.map((existing) => existing.assetId));
  const needle = search.trim().toLowerCase();

  const offered = (library.data?.categories ?? [])
    .flatMap((category) =>
      category.assets.map((asset) => ({ ...asset, categoryName: category.name })),
    )
    .filter((asset) => !linked.has(asset.id))
    .filter((asset) => needle === '' || asset.name.toLowerCase().includes(needle))
    .slice(0, MAXIMUM_OFFERED);

  return (
    <div className={styles.picker}>
      <input
        type="search"
        className={styles.pickerSearch}
        aria-label="Search assets"
        placeholder="Search the library"
        autoFocus
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />

      {library.isPending && <p className={styles.empty}>Loading the library…</p>}

      {library.isSuccess && offered.length === 0 && (
        <p className={styles.empty}>
          {needle === '' ? 'Nothing in the library yet.' : 'Nothing matches that.'}
        </p>
      )}

      <ul className={styles.tiles}>
        {offered.map((asset) => (
          <li key={asset.id} className={styles.tile}>
            <button
              type="button"
              className={joinClassNames(styles.tileOpen)}
              disabled={link.isPending}
              onClick={() => {
                link.mutate({ cardId: card.id, assetId: asset.id });
              }}
            >
              <span className={styles.linkKind} title={asset.categoryName}>
                {asset.categoryName}
              </span>
              <span className={styles.rowTitle} title={asset.name}>
                {asset.name}
              </span>
              <span className={styles.state}>{describeAssetStatus(asset.status)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Enough to choose from without turning the panel into the library itself. */
const MAXIMUM_OFFERED = 12;
