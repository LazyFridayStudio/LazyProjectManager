import {
  describeAssetBlockKind,
  type AssetBlockKind,
  type AssetDetailView,
  type AssetTabBlock,
} from '@lpm/shared';
import { useState, type ReactNode } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import { appendBlock } from '../../logic/markdown/index.js';
import {
  useAddAssetTabBlock,
  useMoveAssetTabBlock,
  useRemoveAssetTabBlock,
  useUpdateAssetTabBlock,
} from '../../logic/assets/use-asset-tabs.js';
import { MarkdownField, MarkdownText } from '../markdown/index.js';
import { Button, ButtonIcon, PencilIcon, PlusIcon, TrashIcon, useDisplay } from '../ui/index.js';
import { AssetChecklist } from './AssetChecklist.js';
import styles from './AssetTabs.module.css';

/**
 * Where a set of blocks lives: one of the asset's tabs, or its Overview.
 *
 * The same blocks, framed and moved and added the same way, in both — the
 * Overview simply has more kinds to choose from.
 */
export interface BlockPlace {
  readonly asset: AssetDetailView;
  /** Null for the Overview. */
  readonly tabId: string | null;
  /** What to call it in a question: "Rig", "the Overview". */
  readonly name: string;
}

export interface AssetBlockListProps {
  readonly place: BlockPlace;
  readonly blocks: readonly AssetTabBlock[];
  readonly projectSlug: string;
  readonly canWrite: boolean;
  /**
   * Draws a block that shows something the asset has, which only the place
   * knows how to: a tab's files are the ones tagged to it, the Overview's are
   * all of them. Notes and checklists are drawn here, the same everywhere.
   */
  readonly drawSection: (block: AssetTabBlock) => ReactNode;
}

/** A place's blocks, top to bottom, each in its frame. */
export function AssetBlockList({
  place,
  blocks,
  projectSlug,
  canWrite,
  drawSection,
}: AssetBlockListProps): React.JSX.Element {
  return (
    <div className={styles.blocks}>
      {blocks.map((block, index) => (
        <BlockFrame
          key={block.id}
          place={place}
          block={block}
          above={blocks[index - 1]}
          below={blocks[index + 1]}
          projectSlug={projectSlug}
          canWrite={canWrite}
        >
          {block.kind === 'notes' || block.kind === 'checklist' ? (
            <WrittenBlock
              place={place}
              block={block}
              projectSlug={projectSlug}
              canWrite={canWrite}
            />
          ) : (
            drawSection(block)
          )}
        </BlockFrame>
      ))}
    </div>
  );
}

interface BlockFrameProps {
  readonly place: BlockPlace;
  readonly block: AssetTabBlock;
  /** The block above this one, which moving up puts it in front of. */
  readonly above: AssetTabBlock | undefined;
  readonly below: AssetTabBlock | undefined;
  readonly projectSlug: string;
  readonly canWrite: boolean;
  readonly children: ReactNode;
}

/** One block, with the controls that move it and take it off in its corner. */
function BlockFrame({
  place,
  block,
  above,
  below,
  projectSlug,
  canWrite,
  children,
}: BlockFrameProps): React.JSX.Element {
  const display = useDisplay();
  const move = useMoveAssetTabBlock(projectSlug, place.asset.id);
  const remove = useRemoveAssetTabBlock(projectSlug, place.asset.id);
  const kind = describeAssetBlockKind(block.kind);

  const report = {
    onError: (error: Error) => {
      display.showError(describeFailure(error));
    },
  };

  return (
    // Named for the block rather than for what is in it: a files block holds
    // the asset's Files, and two landmarks of one name are none.
    <section className={styles.block} aria-label={`${kind} block`}>
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
                  question: `Remove ${kind.toLowerCase()} from ${place.name}?`,
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

      {children}
    </section>
  );
}

/**
 * What taking a block off costs, said before it happens.
 *
 * Two different answers: notes and a checklist are what somebody wrote, and go;
 * everything else shows something the asset has, and only stops showing it.
 */
function whatRemovingLoses(kind: AssetBlockKind): string {
  switch (kind) {
    case 'notes':
      return 'What the notes say goes with them.';
    case 'checklist':
      return 'Every line on the checklist goes with it.';
    case 'files':
      return 'The files stay on the asset. They are only no longer shown here.';
    case 'work':
      return 'The hours stay on the asset. They are only no longer shown here.';
    default:
      return 'Nothing is lost: it is only no longer shown here, and adding it back shows it again.';
  }
}

/** A notes or checklist block: what somebody wrote, the same on a tab or the Overview. */
function WrittenBlock({
  place,
  block,
  projectSlug,
  canWrite,
}: {
  readonly place: BlockPlace;
  readonly block: AssetTabBlock;
  readonly projectSlug: string;
  readonly canWrite: boolean;
}): React.JSX.Element {
  if (block.kind === 'notes') {
    return <NotesBlock place={place} block={block} projectSlug={projectSlug} canWrite={canWrite} />;
  }

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
        assetId={place.asset.id}
        projectSlug={projectSlug}
        items={block.items}
        canWrite={canWrite}
      />
    </>
  );
}

/**
 * Notes: read as they render, and written in the same box a description is.
 *
 * Opened for writing with its own pencil, because the panel's Save is for the
 * asset's own fields and these are saved on their own.
 */
function NotesBlock({
  place,
  block,
  projectSlug,
  canWrite,
}: {
  readonly place: BlockPlace;
  readonly block: AssetTabBlock;
  readonly projectSlug: string;
  readonly canWrite: boolean;
}): React.JSX.Element {
  const [writing, setWriting] = useState<string | null>(null);
  const display = useDisplay();
  const update = useUpdateAssetTabBlock(projectSlug, place.asset.id);
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

  if (writing === null || !canWrite) {
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
          // for the tab it was dropped on when it was dropped on one.
          uploadTo: {
            kind: 'assetFile',
            assetId: place.asset.id,
            ...(place.tabId === null ? {} : { assetTabId: place.tabId }),
          },
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
 * What a place can be built from, one button each.
 *
 * A place has one block of each kind, so a kind it has already is not offered.
 */
export function AssetBlockAdder({
  place,
  blocks,
  offered,
  projectSlug,
}: {
  readonly place: BlockPlace;
  readonly blocks: readonly AssetTabBlock[];
  /** The kinds this place takes, in the order to offer them. */
  readonly offered: readonly AssetBlockKind[];
  readonly projectSlug: string;
}): React.JSX.Element {
  const display = useDisplay();
  const add = useAddAssetTabBlock(projectSlug, place.asset.id);
  const kinds = offered.filter((kind) => !blocks.some((block) => block.kind === kind));

  return (
    <div className={styles.actions}>
      {kinds.map((kind) => {
        // The kind is the word on the button, so the plus and the word are
        // drawn together here.
        const addition = (
          <span className={styles.addLabel}>
            <ButtonIcon>
              <PlusIcon size={12} />
            </ButtonIcon>
            {describeAssetBlockKind(kind)}
          </span>
        );

        return (
          <Button
            key={kind}
            tone="go"
            size="compact"
            aria-label={`Add ${describeAssetBlockKind(kind).toLowerCase()}`}
            title={`Add ${describeAssetBlockKind(kind).toLowerCase()}`}
            disabled={add.isPending}
            onClick={() => {
              add.mutate(
                place.tabId === null
                  ? { assetId: place.asset.id, kind }
                  : { assetTabId: place.tabId, kind },
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
