import type { AssetDetailView } from '@lpm/shared';

import { describeFailure } from '../../api/failure-messages.js';
import { useUpdateAssetTab } from '../../logic/assets/use-asset-tabs.js';
import { useDisplay } from '../ui/index.js';
import styles from './AssetTabs.module.css';

export interface AssetTabsSummaryProps {
  readonly asset: AssetDetailView;
  readonly projectSlug: string;
  readonly canWrite: boolean;
  readonly onOpenTab: (tabId: string) => void;
}

/**
 * The asset's tabs, listed on its Overview: how far along each job is, without
 * opening any of them.
 *
 * A block of the Overview. Ticking one off here, while the asset is being
 * edited, is the same as ticking it off on the tab.
 */
export function AssetTabsSummary({
  asset,
  projectSlug,
  canWrite,
  onOpenTab,
}: AssetTabsSummaryProps): React.JSX.Element {
  const display = useDisplay();
  const update = useUpdateAssetTab(projectSlug, asset.id);
  const inFlight = update.isPending ? update.variables : undefined;
  const shows = (tab: { id: string; done: boolean }): boolean =>
    inFlight?.assetTabId === tab.id && inFlight.done !== undefined ? inFlight.done : tab.done;
  const done = asset.tabs.filter((tab) => shows(tab)).length;

  return (
    <section className={styles.summary} aria-label="Tabs">
      <h3 className={styles.blockHeading}>
        Tabs
        {asset.tabs.length > 0 && (
          <span className={styles.progress}>
            {done}/{asset.tabs.length}
          </span>
        )}
      </h3>

      {asset.tabs.length === 0 ? (
        <p className={styles.empty}>
          {canWrite
            ? 'One job so far. Add a tab for each part of the work — Mesh, Rig, Animation — with the + beside the tabs, or start from a template there.'
            : 'One job so far.'}
        </p>
      ) : (
        <ul className={styles.summaryRows}>
          {asset.tabs.map((tab) => (
            <li key={tab.id} className={styles.summaryRow}>
              <input
                type="checkbox"
                checked={shows(tab)}
                disabled={!canWrite}
                aria-label={`${tab.title} done`}
                onChange={(event) => {
                  update.mutate(
                    { assetTabId: tab.id, done: event.target.checked },
                    {
                      onError: (error) => {
                        display.showError(describeFailure(error));
                      },
                    },
                  );
                }}
              />
              <button
                type="button"
                className={styles.summaryOpen}
                data-done={shows(tab)}
                onClick={() => {
                  onOpenTab(tab.id);
                }}
              >
                {tab.title}
              </button>
              <span className={styles.summaryWho}>
                {[tab.assignee?.initials, tab.dueOn]
                  .filter((part) => part !== undefined && part !== null)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
