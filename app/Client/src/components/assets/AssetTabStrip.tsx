import type { AssetTab } from '@lpm/shared';
import { useState } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import { Button, ButtonIcon, PlusIcon, useDisplay } from '../ui/index.js';
import { useAddAssetTab } from '../../logic/assets/use-asset-tabs.js';
import styles from './AssetTabs.module.css';

/** The Overview, which is the asset itself rather than one of its tabs. */
export const OVERVIEW = 'overview';

export interface AssetTabStripProps {
  readonly assetId: string;
  readonly projectSlug: string;
  readonly tabs: readonly AssetTab[];
  /** The tab being read, or `OVERVIEW`. */
  readonly selected: string;
  readonly canWrite: boolean;
  readonly onSelect: (tabId: string) => void;
}

/**
 * The row along the top of an asset: its Overview, then a tab for each job.
 *
 * The Overview comes first and is always there, because it is the asset itself
 * — what it is, what it looks like, what it costs. The rest are the work, in the
 * order somebody laid it out, and the last thing on the row is the way to add
 * another.
 */
export function AssetTabStrip({
  assetId,
  projectSlug,
  tabs,
  selected,
  canWrite,
  onSelect,
}: AssetTabStripProps): React.JSX.Element {
  return (
    <div className={styles.strip} role="tablist" aria-label="Asset tabs">
      <TabButton
        id={OVERVIEW}
        title="Overview"
        done={false}
        selected={selected}
        onSelect={onSelect}
      />

      {tabs.map((tab) => (
        <TabButton
          key={tab.id}
          id={tab.id}
          title={tab.title}
          done={tab.done}
          selected={selected}
          onSelect={onSelect}
        />
      ))}

      {canWrite && <TabAdder assetId={assetId} projectSlug={projectSlug} onAdded={onSelect} />}
    </div>
  );
}

function TabButton({
  id,
  title,
  done,
  selected,
  onSelect,
}: {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
  readonly selected: string;
  readonly onSelect: (tabId: string) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      className={styles.tab}
      aria-selected={selected === id}
      data-done={done}
      onClick={() => {
        onSelect(id);
      }}
    >
      {title}
      {/* A tick rather than the word, because the row is read at a glance. The
          checkbox inside the tab says it in words. */}
      {done && (
        <span className={styles.tick} aria-label="done">
          ✓
        </span>
      )}
    </button>
  );
}

/**
 * The button that opens a field for a new tab, and the field it opens.
 *
 * The new tab is opened as soon as it exists, because the next thing anybody
 * does with a tab called Rig is put something on it.
 */
function TabAdder({
  assetId,
  projectSlug,
  onAdded,
}: {
  readonly assetId: string;
  readonly projectSlug: string;
  readonly onAdded: (tabId: string) => void;
}): React.JSX.Element {
  const [typed, setTyped] = useState<string | null>(null);
  const display = useDisplay();
  const add = useAddAssetTab(projectSlug, assetId);

  if (typed === null) {
    return (
      <Button
        tone="go"
        size="compact"
        aria-label="Add tab"
        title="Add tab"
        onClick={() => {
          setTyped('');
        }}
      >
        <span className={styles.addLabel}>
          <ButtonIcon>
            <PlusIcon size={12} />
          </ButtonIcon>
          Add tab
        </span>
      </Button>
    );
  }

  const submit = (): void => {
    const title = typed.trim();

    if (title === '') {
      setTyped(null);

      return;
    }

    add.mutate(
      { assetId, title },
      {
        onSuccess: (made) => {
          setTyped(null);

          if (made.id !== undefined) onAdded(made.id);
        },
        onError: (error) => {
          display.showError(describeFailure(error));
        },
      },
    );
  };

  return (
    <input
      className={styles.tabInput}
      aria-label="New tab"
      placeholder="Rig"
      autoFocus
      value={typed}
      disabled={add.isPending}
      onChange={(event) => {
        setTyped(event.target.value);
      }}
      onKeyDown={(event) => {
        // The panel is a form, so without this Enter would submit it.
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          setTyped(null);
        }
      }}
      onBlur={() => {
        if (!add.isPending) setTyped(null);
      }}
    />
  );
}
