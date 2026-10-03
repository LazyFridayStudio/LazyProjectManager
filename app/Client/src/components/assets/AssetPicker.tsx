import { describeAssetStatus, type AssetCategory, type AssetTile } from '@lpm/shared';
import { useState } from 'react';

import { useAssetLibrary } from '../../logic/assets/use-assets.js';
import styles from '../board/card-detail/CardActivity.module.css';

export interface AssetPickerProps {
  readonly projectSlug: string;
  /** What is not on offer: whatever is already linked, and the asset itself. */
  readonly exclude: ReadonlySet<string>;
  /** Whether a pick is on its way, so a second press does not send another. */
  readonly busy: boolean;
  readonly onPick: (assetId: string) => void;
}

/**
 * What there is to link to.
 *
 * The library the project already has, filtered as somebody types. It is read
 * through the same query the asset screen uses rather than a search of its own —
 * a project's library is small enough to hold, and one endpoint fewer is one
 * fewer to keep in step.
 *
 * One picker for a card's assets and an asset's, because both are the same
 * question — which thing in this library — and two copies would drift the first
 * time one of them learned to search by tag.
 */
export function AssetPicker({
  projectSlug,
  exclude,
  busy,
  onPick,
}: AssetPickerProps): React.JSX.Element {
  const library = useAssetLibrary(projectSlug);
  const [search, setSearch] = useState('');

  const needle = search.trim().toLowerCase();

  const offered = (library.data?.categories ?? [])
    .flatMap(everyAssetUnder)
    .filter((asset) => !exclude.has(asset.id))
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
              className={styles.tileOpen}
              disabled={busy}
              onClick={() => {
                onPick(asset.id);
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

/**
 * Every asset in a category and in the categories inside it.
 *
 * All the way down: a category's own `assets` are only the ones filed directly
 * in it, and a picker that stopped there would never offer the helm filed under
 * Armour, then Helmets.
 *
 * Named after the heading it sits directly under, which is the one a tile in the
 * library shows — `Helmets`, not `Armour`.
 */
function everyAssetUnder(category: AssetCategory): (AssetTile & { categoryName: string })[] {
  return [
    ...category.assets.map((asset) => ({ ...asset, categoryName: category.name })),
    ...category.categories.flatMap(everyAssetUnder),
  ];
}

/** Enough to choose from without turning the panel into the library itself. */
const MAXIMUM_OFFERED = 12;
