import type { AssetDetailView } from '@lpm/shared';
import { useState } from 'react';

import { Button, ButtonIcon, PlusIcon, SaveIcon } from '../ui/index.js';
import { AddTabDialog, SaveTemplateDialog } from './AssetTabDialogs.js';
import styles from './AssetTabs.module.css';

/** The Overview, which is the asset itself rather than one of its tabs. */
export const OVERVIEW = 'overview';

export interface AssetTabStripProps {
  readonly asset: AssetDetailView;
  readonly projectSlug: string;
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
  asset,
  projectSlug,
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

      {asset.tabs.map((tab) => (
        <TabButton
          key={tab.id}
          id={tab.id}
          title={tab.title}
          done={tab.done}
          selected={selected}
          onSelect={onSelect}
        />
      ))}

      {canWrite && <RowActions asset={asset} projectSlug={projectSlug} onAdded={onSelect} />}
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
 * The two things done to the row itself, at its end: adding a tab — named, or
 * from a template — and keeping this asset's tabs as a template.
 *
 * Marks rather than words, because they sit among tabs and a word there reads
 * as one more tab.
 */
function RowActions({
  asset,
  projectSlug,
  onAdded,
}: {
  readonly asset: AssetDetailView;
  readonly projectSlug: string;
  readonly onAdded: (tabId: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState<'add' | 'save' | null>(null);
  const close = (): void => {
    setOpen(null);
  };
  const canSave = asset.canManageTemplates && (asset.tabs.length > 0 || asset.overview.length > 0);

  return (
    <span className={styles.rowActions}>
      <Button
        tone="go"
        size="compact"
        aria-label="Add tab"
        title="Add a tab, or start from a template"
        onClick={() => {
          setOpen('add');
        }}
      >
        <ButtonIcon>
          <PlusIcon size={13} />
        </ButtonIcon>
      </Button>

      {canSave && (
        <Button
          tone="go"
          size="compact"
          aria-label="Save as a template"
          title="Save as a template"
          onClick={() => {
            setOpen('save');
          }}
        >
          <ButtonIcon>
            <SaveIcon size={13} />
          </ButtonIcon>
        </Button>
      )}

      {open === 'add' && (
        <AddTabDialog asset={asset} projectSlug={projectSlug} onAdded={onAdded} onDone={close} />
      )}
      {open === 'save' && <SaveTemplateDialog asset={asset} onDone={close} />}
    </span>
  );
}
