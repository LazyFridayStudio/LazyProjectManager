import { describeAssetStatus, ASSET_STATUSES } from '@lpm/shared';

import { joinClassNames } from '../../lib/join-class-names.js';
import {
  countFilters,
  isFiltering,
  toggleStatus,
  toggleTag,
  NO_FILTERS,
  type AssetFilters,
} from '../../logic/assets/asset-filters.js';
import styles from './AssetFilterPanel.module.css';

export interface AssetFilterPanelProps {
  readonly filters: AssetFilters;
  /** Every tag anybody has used in this project, whatever is chosen now. */
  readonly availableTags: readonly string[];
  readonly onChange: (filters: AssetFilters) => void;
  readonly onHide: () => void;
}

/**
 * What the library is narrowed to.
 *
 * Chips rather than checkboxes, and pressing one that is already on is how it
 * comes off — a separate remove would be a second control for the same idea.
 *
 * The tags on offer are every tag the project uses rather than only the ones
 * surviving the filter already applied. Otherwise choosing one tag would empty
 * the row it came from, and there would be no way back except to clear.
 */
export function AssetFilterPanel({
  filters,
  availableTags,
  onChange,
  onHide,
}: AssetFilterPanelProps): React.JSX.Element {
  const chosen = countFilters(filters);

  return (
    <section className={styles.panel} aria-label="Filters">
      <div className={styles.head}>
        <span className={styles.title}>Filters</span>
        <span className={styles.summary}>{chosen === 0 ? 'none' : `${String(chosen)} chosen`}</span>

        <span className={styles.links}>
          {isFiltering(filters) && (
            <button
              type="button"
              className={styles.clear}
              onClick={() => {
                onChange(NO_FILTERS);
              }}
            >
              Clear all
            </button>
          )}

          <button type="button" className={styles.hide} onClick={onHide}>
            Hide
          </button>
        </span>
      </div>

      <div className={styles.group}>
        <span className={styles.groupLabel}>Status</span>
        <div className={styles.chips}>
          {ASSET_STATUSES.map((status) => (
            <Chip
              key={status}
              label={describeAssetStatus(status)}
              isOn={filters.statuses.includes(status)}
              onPress={() => {
                onChange(toggleStatus(filters, status));
              }}
            >
              <span className={styles.statusDot} data-status={status} aria-hidden />
            </Chip>
          ))}
        </div>
      </div>

      <div className={styles.group}>
        <span className={styles.groupLabel}>Tags — matches assets carrying every selected tag</span>

        {availableTags.length === 0 ? (
          <p className={styles.none}>Nothing has been tagged yet.</p>
        ) : (
          <div className={styles.chips}>
            {availableTags.map((tag) => (
              <Chip
                key={tag}
                label={tag}
                isTag
                isOn={filters.tags.includes(tag)}
                onPress={() => {
                  onChange(toggleTag(filters, tag));
                }}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

interface ChipProps {
  readonly label: string;
  readonly isOn: boolean;
  readonly isTag?: boolean;
  readonly onPress: () => void;
  readonly children?: React.ReactNode;
}

/** One thing to narrow by, on or off. */
function Chip({ label, isOn, isTag = false, onPress, children }: ChipProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={joinClassNames(styles.chip, isTag && styles.tagChip, isOn && styles.chipOn)}
      aria-pressed={isOn}
      onClick={onPress}
    >
      {children}
      {label}
    </button>
  );
}
