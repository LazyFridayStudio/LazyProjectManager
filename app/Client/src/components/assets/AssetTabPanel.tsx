import {
  ASSET_TAB_BLOCK_KINDS,
  type AssetDetailView,
  type AssetTab,
  type AssetTabBlock,
} from '@lpm/shared';
import { useState } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import {
  useDeleteAssetTab,
  useMoveAssetTab,
  useUpdateAssetTab,
} from '../../logic/assets/use-asset-tabs.js';
import { PersonPicker } from '../projects/index.js';
import { Button, ButtonIcon, Field, PencilIcon, TrashIcon, useDisplay } from '../ui/index.js';
import { WorkLog } from '../work/index.js';
import {
  AssetBlockAdder,
  AssetBlockList,
  AssetCard,
  AssetPerson,
  type BlockPlace,
} from './AssetBlocks.js';
import { AssetFiles } from './AssetFiles.js';
import styles from './AssetTabs.module.css';

export interface AssetTabPanelProps {
  readonly asset: AssetDetailView;
  readonly tab: AssetTab;
  readonly projectSlug: string;
  readonly canWrite: boolean;
  /** Called once the tab has gone, so the panel can go back to the Overview. */
  readonly onGone: () => void;
}

/**
 * One job inside an asset: who is doing it, by when, and what it is built from.
 *
 * Read as text until the asset is being edited, as the rest of the panel is:
 * opening an asset to look at it should not put a row of buttons and armed
 * checkboxes under every glance. In edit mode each change saves as it is made,
 * because a tab has no form of its own to submit.
 */
export function AssetTabPanel({
  asset,
  tab,
  projectSlug,
  canWrite,
  onGone,
}: AssetTabPanelProps): React.JSX.Element {
  const place: BlockPlace = { asset, tabId: tab.id, name: tab.title };

  return (
    <div className={styles.panel} role="tabpanel" aria-label={tab.title}>
      <AssetCard label="Tab">
        <TabHead
          asset={asset}
          tab={tab}
          projectSlug={projectSlug}
          canWrite={canWrite}
          onGone={onGone}
        />

        <TabFacts asset={asset} tab={tab} projectSlug={projectSlug} canWrite={canWrite} />
      </AssetCard>

      {tab.blocks.length === 0 && (
        <p className={styles.empty}>
          {canWrite
            ? 'Nothing on this tab yet. Build it from the blocks below.'
            : 'Nothing on this tab yet.'}
        </p>
      )}

      <AssetBlockList
        place={place}
        blocks={tab.blocks}
        projectSlug={projectSlug}
        canWrite={canWrite}
        drawSection={(block) => (
          <TabSection
            asset={asset}
            tab={tab}
            block={block}
            projectSlug={projectSlug}
            canWrite={canWrite}
          />
        )}
      />

      {canWrite && (
        <AssetBlockAdder
          place={place}
          blocks={tab.blocks}
          offered={ASSET_TAB_BLOCK_KINDS}
          projectSlug={projectSlug}
        />
      )}
    </div>
  );
}

interface TabPartProps {
  readonly asset: AssetDetailView;
  readonly tab: AssetTab;
  readonly projectSlug: string;
  readonly canWrite: boolean;
}

/**
 * The tab's name, and what can be done to the tab itself: rename it, move it
 * along the row, delete it.
 */
function TabHead({
  asset,
  tab,
  projectSlug,
  canWrite,
  onGone,
}: TabPartProps & { readonly onGone: () => void }): React.JSX.Element {
  const [isRenaming, setIsRenaming] = useState(false);

  if (isRenaming) {
    return (
      <RenameTab
        asset={asset}
        tab={tab}
        projectSlug={projectSlug}
        onDone={() => {
          setIsRenaming(false);
        }}
      />
    );
  }

  return (
    <div className={styles.panelHead}>
      <h3 className={styles.panelTitle}>{tab.title}</h3>

      {canWrite && (
        <TabControls
          asset={asset}
          tab={tab}
          projectSlug={projectSlug}
          onRename={() => {
            setIsRenaming(true);
          }}
          onGone={onGone}
        />
      )}
    </div>
  );
}

/** The tab's name, being typed over. Enter keeps it and Escape gives up. */
function RenameTab({
  asset,
  tab,
  projectSlug,
  onDone,
}: Omit<TabPartProps, 'canWrite'> & { readonly onDone: () => void }): React.JSX.Element {
  const [typed, setTyped] = useState(tab.title);
  const display = useDisplay();
  const update = useUpdateAssetTab(projectSlug, asset.id);

  const rename = (): void => {
    const title = typed.trim();

    if (title === '' || title === tab.title) {
      onDone();

      return;
    }

    update.mutate(
      { assetTabId: tab.id, title },
      {
        onSuccess: onDone,
        onError: (error) => {
          display.showError(describeFailure(error));
        },
      },
    );
  };

  return (
    <div className={styles.panelHead}>
      <input
        className={styles.tabInput}
        aria-label="Tab name"
        autoFocus
        value={typed}
        disabled={update.isPending}
        onChange={(event) => {
          setTyped(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            rename();
          }

          if (event.key === 'Escape') {
            event.preventDefault();
            onDone();
          }
        }}
        onBlur={rename}
      />
    </div>
  );
}

/** Moving the tab along the row, renaming it, and deleting it. */
function TabControls({
  asset,
  tab,
  projectSlug,
  onRename,
  onGone,
}: Omit<TabPartProps, 'canWrite'> & {
  readonly onRename: () => void;
  readonly onGone: () => void;
}): React.JSX.Element {
  const display = useDisplay();
  const move = useMoveAssetTab(projectSlug, asset.id);
  const remove = useDeleteAssetTab(projectSlug, asset.id);
  const position = asset.tabs.findIndex((each) => each.id === tab.id);
  const earlier = asset.tabs[position - 1];
  const later = asset.tabs[position + 1];

  const report = {
    onError: (error: Error) => {
      display.showError(describeFailure(error));
    },
  };

  return (
    <>
      {/* Along the row rather than up and down: the tabs read left to right, so
          earlier is left. */}
      <button
        type="button"
        className={styles.quiet}
        aria-label="Move tab earlier"
        title="Move tab earlier"
        disabled={earlier === undefined || move.isPending}
        onClick={() => {
          move.mutate({ assetTabId: tab.id, beforeTabId: earlier?.id }, report);
        }}
      >
        ←
      </button>
      <button
        type="button"
        className={styles.quiet}
        aria-label="Move tab later"
        title="Move tab later"
        disabled={later === undefined || move.isPending}
        onClick={() => {
          move.mutate({ assetTabId: tab.id, afterTabId: later?.id }, report);
        }}
      >
        →
      </button>
      {/* Buttons rather than the quiet marks beside them: renaming and deleting
          the tab are the two things somebody comes to a tab's card to do, and
          a faint bin in a corner is one they cannot find. */}
      <Button size="compact" aria-label="Rename tab" title="Rename tab" onClick={onRename}>
        <ButtonIcon>
          <PencilIcon size={13} />
        </ButtonIcon>
      </Button>
      <Button
        tone="stop"
        size="compact"
        aria-label="Delete tab"
        title="Delete tab"
        busy={remove.isPending}
        onClick={() => {
          void (async () => {
            const said = await display.askToConfirm({
              question: `Delete ${tab.title}?`,
              // The files and hours are the part somebody would worry about, and
              // they are the part that stays.
              consequence:
                'Its notes and checklists go with it. Files and hours logged for it stay on the asset. It waits a week in the bin, and can be put back until then.',
              confirmLabel: 'Delete tab',
            });

            if (said) remove.mutate({ assetTabId: tab.id }, { ...report, onSuccess: onGone });
          })();
        }}
      >
        <ButtonIcon>
          <TrashIcon size={13} />
        </ButtonIcon>
      </Button>
    </>
  );
}

/**
 * Whether the job is done, who is doing it, and by when.
 *
 * Each saves the moment it changes, as a checkbox on a card does: there is no
 * form here to submit, and a date chosen and then lost because nobody pressed
 * Save is a date nobody trusts.
 */
function TabFacts(props: TabPartProps): React.JSX.Element {
  return props.canWrite ? <TabFactsEditing {...props} /> : <TabFactsRead tab={props.tab} />;
}

/** The same three facts as text, while the asset is being read. */
function TabFactsRead({ tab }: { readonly tab: AssetTab }): React.JSX.Element {
  return (
    <div className={styles.people}>
      <p className={styles.readFacts}>
        <span>
          <strong>{tab.done ? 'Done' : 'Not done yet'}</strong>
        </span>
        <span>
          Due <strong>{tab.dueOn ?? 'no date'}</strong>
        </span>
      </p>
      <AssetPerson role="Assignee" person={tab.assignee} nobody="Nobody yet" />
    </div>
  );
}

function TabFactsEditing({ asset, tab, projectSlug, canWrite }: TabPartProps): React.JSX.Element {
  const display = useDisplay();
  const update = useUpdateAssetTab(projectSlug, asset.id);
  const inFlight = update.isPending ? update.variables : undefined;
  const done = inFlight?.done ?? tab.done;

  const report = {
    onError: (error: Error) => {
      display.showError(describeFailure(error));
    },
  };

  return (
    <>
      <label className={styles.done}>
        <input
          type="checkbox"
          checked={done}
          disabled={!canWrite}
          onChange={(event) => {
            update.mutate({ assetTabId: tab.id, done: event.target.checked }, report);
          }}
        />
        Done
      </label>

      <div className={styles.pair}>
        <PersonPicker
          label="Assignee"
          nobody="Nobody yet"
          projectId={asset.project.id}
          value={tab.assignee?.userId ?? ''}
          was={tab.assignee}
          disabled={!canWrite}
          onChange={(event) => {
            const chosen = event.target.value;

            update.mutate(
              { assetTabId: tab.id, assigneeId: chosen === '' ? null : chosen },
              report,
            );
          }}
        />
        <Field
          label="Due"
          type="date"
          value={tab.dueOn ?? ''}
          disabled={!canWrite}
          onChange={(event) => {
            const chosen = event.target.value;

            update.mutate({ assetTabId: tab.id, dueOn: chosen === '' ? null : chosen }, report);
          }}
        />
      </div>
    </>
  );
}

/**
 * A tab's files and hours: the asset's, narrowed to the ones that say they were
 * for this tab, and what is added here says so too.
 */
function TabSection({
  asset,
  tab,
  block,
  projectSlug,
  canWrite,
}: TabPartProps & { readonly block: AssetTabBlock }): React.JSX.Element | null {
  if (block.kind === 'files') {
    return (
      <AssetFiles
        assetId={asset.id}
        projectSlug={projectSlug}
        files={asset.files.filter((file) => file.tabId === tab.id)}
        canWrite={canWrite}
        tabId={tab.id}
      />
    );
  }

  if (block.kind === 'work') {
    const entries = asset.work.entries.filter((entry) => entry.assetTabId === tab.id);

    return (
      <WorkLog
        what={{ assetId: asset.id, assetTabId: tab.id }}
        work={{
          entries,
          loggedMinutes: entries.reduce((total, entry) => total + entry.minutes, 0),
        }}
        // An asset is estimated in money rather than in time, and a tab is not
        // estimated at all, so there is nothing to hold the hours against.
        estimateMinutes={null}
        canWrite={canWrite}
      />
    );
  }

  // Nothing else goes on a tab; the server refuses it.
  return null;
}
