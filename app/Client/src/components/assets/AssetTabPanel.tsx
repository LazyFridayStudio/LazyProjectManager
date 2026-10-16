import {
  ASSET_TAB_BLOCK_KINDS,
  ASSET_TAB_VIEW_BLOCK_KINDS,
  describeAssetTabBlockKind,
  type AssetDetailView,
  type AssetTab,
  type AssetTabBlock,
  type AssetTabBlockKind,
} from '@lpm/shared';
import { useState } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import { appendBlock } from '../../logic/markdown/index.js';
import {
  useAddAssetTabBlock,
  useDeleteAssetTab,
  useMoveAssetTab,
  useMoveAssetTabBlock,
  useRemoveAssetTabBlock,
  useUpdateAssetTab,
  useUpdateAssetTabBlock,
} from '../../logic/assets/use-asset-tabs.js';
import { MarkdownField, MarkdownText } from '../markdown/index.js';
import { PersonPicker } from '../projects/index.js';
import {
  Button,
  ButtonIcon,
  Field,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  useDisplay,
} from '../ui/index.js';
import { WorkLog } from '../work/index.js';
import { AssetChecklist } from './AssetChecklist.js';
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
  return (
    <div className={styles.panel} role="tabpanel" aria-label={tab.title}>
      <TabHead
        asset={asset}
        tab={tab}
        projectSlug={projectSlug}
        canWrite={canWrite}
        onGone={onGone}
      />

      <TabFacts asset={asset} tab={tab} projectSlug={projectSlug} canWrite={canWrite} />

      {tab.blocks.length === 0 && (
        <p className={styles.empty}>
          {canWrite
            ? 'Nothing on this tab yet. Build it from the blocks below.'
            : 'Nothing on this tab yet.'}
        </p>
      )}

      <div className={styles.blocks}>
        {tab.blocks.map((block, index) => (
          <BlockFrame
            key={block.id}
            asset={asset}
            tab={tab}
            block={block}
            above={tab.blocks[index - 1]}
            below={tab.blocks[index + 1]}
            projectSlug={projectSlug}
            canWrite={canWrite}
          />
        ))}
      </div>

      {canWrite && <BlockAdder asset={asset} tab={tab} projectSlug={projectSlug} />}
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
      <button
        type="button"
        className={styles.quiet}
        aria-label="Rename tab"
        title="Rename tab"
        onClick={onRename}
      >
        <PencilIcon size={13} />
      </button>
      <button
        type="button"
        className={joinClassNames(styles.quiet, styles.quietStop)}
        aria-label="Delete tab"
        title="Delete tab"
        disabled={remove.isPending}
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
        <TrashIcon size={13} />
      </button>
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
    <p className={styles.readFacts}>
      <span>
        <strong>{tab.done ? 'Done' : 'Not done yet'}</strong>
      </span>
      <span>
        Assignee <strong>{tab.assignee?.displayName ?? 'nobody yet'}</strong>
      </span>
      <span>
        Due <strong>{tab.dueOn ?? 'no date'}</strong>
      </span>
    </p>
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

interface BlockFrameProps extends TabPartProps {
  readonly block: AssetTabBlock;
  /** The block above this one, which moving up puts it in front of. */
  readonly above: AssetTabBlock | undefined;
  readonly below: AssetTabBlock | undefined;
}

/** One block, with the controls that move it and take it off in its corner. */
function BlockFrame({
  asset,
  tab,
  block,
  above,
  below,
  projectSlug,
  canWrite,
}: BlockFrameProps): React.JSX.Element {
  const display = useDisplay();
  const move = useMoveAssetTabBlock(projectSlug, asset.id);
  const remove = useRemoveAssetTabBlock(projectSlug, asset.id);
  const kind = describeAssetTabBlockKind(block.kind);

  const report = {
    onError: (error: Error) => {
      display.showError(describeFailure(error));
    },
  };

  return (
    <section className={styles.block} aria-label={kind}>
      {canWrite && (
        <div className={styles.blockControls}>
          <button
            type="button"
            className={styles.quiet}
            aria-label={`Move ${kind.toLowerCase()} up`}
            title="Move up"
            disabled={above === undefined || move.isPending}
            onClick={() => {
              move.mutate({ blockId: block.id, beforeBlockId: above?.id }, report);
            }}
          >
            ↑
          </button>
          <button
            type="button"
            className={styles.quiet}
            aria-label={`Move ${kind.toLowerCase()} down`}
            title="Move down"
            disabled={below === undefined || move.isPending}
            onClick={() => {
              move.mutate({ blockId: block.id, afterBlockId: below?.id }, report);
            }}
          >
            ↓
          </button>
          <button
            type="button"
            className={joinClassNames(styles.quiet, styles.quietStop)}
            aria-label={`Remove ${kind.toLowerCase()}`}
            title={`Remove ${kind.toLowerCase()}`}
            disabled={remove.isPending}
            onClick={() => {
              void (async () => {
                const said = await display.askToConfirm({
                  question: `Remove ${kind.toLowerCase()} from ${tab.title}?`,
                  consequence: whatRemovingLoses(block.kind),
                  confirmLabel: 'Remove',
                });

                if (said) remove.mutate({ blockId: block.id }, report);
              })();
            }}
          >
            <TrashIcon size={13} />
          </button>
        </div>
      )}

      <BlockBody
        asset={asset}
        tab={tab}
        block={block}
        projectSlug={projectSlug}
        canWrite={canWrite}
      />
    </section>
  );
}

/**
 * What taking a block off costs, said before it happens.
 *
 * Two different answers: notes and a checklist are what somebody wrote, and go;
 * files and hours are the asset's, and only stop being shown here.
 */
function whatRemovingLoses(kind: AssetTabBlockKind): string {
  switch (kind) {
    case 'notes':
      return 'What the notes say goes with them.';
    case 'checklist':
      return 'Every line on the checklist goes with it.';
    case 'files':
      return 'The files stay on the asset. They are only no longer shown on this tab.';
    case 'work':
      return 'The hours stay on the asset. They are only no longer shown on this tab.';
  }
}

function BlockBody({
  asset,
  tab,
  block,
  projectSlug,
  canWrite,
}: TabPartProps & { readonly block: AssetTabBlock }): React.JSX.Element {
  switch (block.kind) {
    case 'notes':
      return (
        <NotesBlock
          asset={asset}
          tab={tab}
          block={block}
          projectSlug={projectSlug}
          canWrite={canWrite}
        />
      );

    case 'checklist': {
      const done = block.items.filter((item) => item.done).length;

      return (
        <>
          <h4 className={styles.blockHeading}>
            Checklist
            {block.items.length > 0 && (
              <span className={styles.progress}>
                {done}/{block.items.length}
              </span>
            )}
          </h4>
          <AssetChecklist
            blockId={block.id}
            assetId={asset.id}
            projectSlug={projectSlug}
            items={block.items}
            canWrite={canWrite}
          />
        </>
      );
    }

    case 'files':
      return (
        <AssetFiles
          assetId={asset.id}
          projectSlug={projectSlug}
          files={asset.files.filter((file) => file.tabId === tab.id)}
          canWrite={canWrite}
          tabId={tab.id}
        />
      );

    case 'work': {
      const entries = asset.work.entries.filter((entry) => entry.assetTabId === tab.id);

      return (
        <WorkLog
          what={{ assetId: asset.id, assetTabId: tab.id }}
          work={{
            entries,
            loggedMinutes: entries.reduce((total, entry) => total + entry.minutes, 0),
          }}
          // An asset is estimated in money rather than in time, and a tab is
          // not estimated at all, so there is nothing to hold the hours against.
          estimateMinutes={null}
          canWrite={canWrite}
        />
      );
    }
  }
}

/**
 * Notes on a tab: read as they render, and written in the same box a
 * description is.
 *
 * Opened for writing with its own pencil rather than the panel's Edit, because
 * the panel's Edit is for the asset and these belong to the tab.
 */
function NotesBlock({
  asset,
  tab,
  block,
  projectSlug,
  canWrite,
}: TabPartProps & { readonly block: AssetTabBlock }): React.JSX.Element {
  const [writing, setWriting] = useState<string | null>(null);
  const display = useDisplay();
  const update = useUpdateAssetTabBlock(projectSlug, asset.id);
  const body = block.body ?? '';

  const save = (): void => {
    update.mutate(
      { blockId: block.id, body: writing ?? body },
      {
        onSuccess: () => {
          setWriting(null);
        },
        onError: (error) => {
          display.showError(describeFailure(error));
        },
      },
    );
  };

  if (writing === null) {
    return (
      <>
        <h4 className={styles.blockHeading}>Notes</h4>
        {body.trim() === '' ? (
          <p className={styles.empty}>Nothing written yet.</p>
        ) : (
          <MarkdownText source={body} />
        )}
        {canWrite && (
          <div className={styles.actions}>
            <Button
              size="compact"
              aria-label="Edit notes"
              title="Edit notes"
              onClick={() => {
                setWriting(body);
              }}
            >
              <ButtonIcon>
                <PencilIcon size={12} />
              </ButtonIcon>
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <h4 className={styles.blockHeading}>Notes</h4>
      <MarkdownField
        label="Notes"
        className={joinClassNames(styles.notesBox)}
        value={writing}
        files={{
          // A file dropped into the notes is a working file of the asset, and
          // it is for this tab.
          uploadTo: { kind: 'assetFile', assetId: asset.id, assetTabId: tab.id },
          onInsert: (markdown: string) => {
            setWriting((current) => appendBlock(current ?? '', markdown));
          },
        }}
        onChange={(event) => {
          setWriting(event.target.value);
        }}
        onReplace={setWriting}
      />
      <div className={styles.actions}>
        <Button tone="go" busy={update.isPending} busyLabel="Saving…" onClick={save}>
          Save notes
        </Button>
        <Button
          tone="stop"
          onClick={() => {
            setWriting(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </>
  );
}

/**
 * What a tab can be built from, one button each.
 *
 * A files block and a work block show what is tagged to the tab, so once a tab
 * has one there is nothing a second would add, and it is not offered.
 */
function BlockAdder({
  asset,
  tab,
  projectSlug,
}: {
  readonly asset: AssetDetailView;
  readonly tab: AssetTab;
  readonly projectSlug: string;
}): React.JSX.Element {
  const display = useDisplay();
  const add = useAddAssetTabBlock(projectSlug, asset.id);
  const offered = ASSET_TAB_BLOCK_KINDS.filter(
    (kind) =>
      !ASSET_TAB_VIEW_BLOCK_KINDS.includes(kind) ||
      !tab.blocks.some((block) => block.kind === kind),
  );

  return (
    <div className={styles.actions}>
      {offered.map((kind) => {
        // The kind is the word on the button, so the plus and the word are
        // drawn together here.
        const addition = (
          <span className={styles.addLabel}>
            <ButtonIcon>
              <PlusIcon size={12} />
            </ButtonIcon>
            {describeAssetTabBlockKind(kind)}
          </span>
        );

        return (
          <Button
            key={kind}
            tone="go"
            size="compact"
            aria-label={`Add ${describeAssetTabBlockKind(kind).toLowerCase()}`}
            title={`Add ${describeAssetTabBlockKind(kind).toLowerCase()}`}
            disabled={add.isPending}
            onClick={() => {
              add.mutate(
                { assetTabId: tab.id, kind },
                {
                  onError: (error) => {
                    display.showError(describeFailure(error));
                  },
                },
              );
            }}
          >
            {addition}
          </Button>
        );
      })}
    </div>
  );
}
