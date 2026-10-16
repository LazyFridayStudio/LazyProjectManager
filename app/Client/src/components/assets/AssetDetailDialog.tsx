import { describeAssetPhase, type AssetDetailView } from '@lpm/shared';
import { useEffect, useRef, useState } from 'react';

import { describeFailure, readFieldProblems } from '../../api/failure-messages.js';
import {
  Button,
  ButtonIcon,
  CloseIcon,
  Loading,
  PencilIcon,
  TrashIcon,
  useArrivesWith,
  useHeightFollows,
  useModalDialog,
} from '../ui/index.js';
import { AssetCard } from './AssetBlocks.js';
import { AssetOverview, type AssetFormState } from './AssetOverview.js';
import { AssetTabPanel } from './AssetTabPanel.js';
import { AssetTabStrip, OVERVIEW } from './AssetTabStrip.js';
import { formatTimeAgo, toMinorUnits } from '../../logic/projects/format-project-values.js';
import { AssetReferenceSheet } from './AssetReferenceSheet.js';
import { useAsset, useUpdateAsset, type UpdateAssetInput } from '../../logic/assets/use-assets.js';
import { useAskToDeleteAsset } from '../../logic/assets/use-delete-asset.js';
import styles from './AssetLibraryScreen.module.css';

export interface AssetDetailDialogProps {
  readonly assetId: string;
  readonly projectSlug: string;
  readonly onClose: () => void;
  /**
   * Opens a card that is about this asset. Absent where there is nowhere to
   * open one — the board renders this over itself and already has a card panel.
   */
  readonly onOpenCard?: (cardId: string) => void;
  /**
   * Opens another asset in this one's place: one it is linked to. Absent where
   * the screen has no way to change which asset is open.
   */
  readonly onOpenAsset?: (assetId: string) => void;
}

/**
 * One asset, opened over the library.
 *
 * Two columns: what it looks like on the left, what is known about it on the
 * right. An asset is a thing being made, so the pictures are the larger half —
 * somebody opening one is usually asking what it looks like now, and only then
 * what it costs.
 *
 * It opens to be read, as a card does. Most times an asset is opened it is to
 * find something out, and a panel full of live inputs invites a stray keystroke
 * into somebody else's estimate.
 */
export function AssetDetailDialog({
  assetId,
  projectSlug,
  onClose,
  onOpenCard,
  onOpenAsset,
}: AssetDetailDialogProps): React.JSX.Element {
  const dialog = useModalDialog(onClose, 'panel');
  const asset = useAsset(assetId);
  const contents = useRef<HTMLFormElement>(null);

  // Following a link keeps the panel and moves the next asset into it, so it
  // reads as the same window showing something else rather than a page change.
  useArrivesWith(contents, asset.data?.id, 'swap');

  return (
    <dialog {...dialog.dialogProps} className={styles.detailDialog} aria-label="Asset">
      {asset.isPending && <Loading what="Loading the asset" />}

      {asset.isError && (
        <p className={styles.problem} role="alert">
          {describeFailure(asset.error)}
        </p>
      )}

      {asset.isSuccess && (
        <AssetForm
          key={asset.data.id}
          ref={contents}
          panel={dialog.dialogProps.ref}
          asset={asset.data}
          projectSlug={projectSlug}
          onDone={dialog.close}
          onOpenCard={onOpenCard}
          onOpenAsset={onOpenAsset}
        />
      )}
    </dialog>
  );
}

function toForm(asset: AssetDetailView): AssetFormState {
  return {
    name: asset.name,
    phase: asset.phase,
    cost: asset.estimatedCostMinor === null ? '' : String(asset.estimatedCostMinor / 100),
    dueOn: asset.dueOn ?? '',
    description: asset.description ?? '',
    assigneeId: asset.assignee?.userId ?? '',
    reporterId: asset.reporter?.userId ?? '',
  };
}

/** What the panel's boxes say, as the change to save. The way back from `toForm`. */
function fromForm(assetId: string, form: AssetFormState): UpdateAssetInput {
  return {
    assetId,
    name: form.name.trim(),
    phase: form.phase,
    estimatedCostMinor: form.cost.trim() === '' ? null : toMinorUnits(form.cost),
    dueOn: form.dueOn === '' ? null : form.dueOn,
    description: form.description.trim() === '' ? null : form.description,
    assigneeId: chosenOrNobody(form.assigneeId),
    reporterId: chosenOrNobody(form.reporterId),
  };
}

/**
 * An empty box is nobody, rather than somebody called nothing.
 *
 * The same rule the card form keeps, and the reason the panel can clear a name
 * at all: `null` says take them off, and leaving the field out would say leave
 * them where they are.
 */
function chosenOrNobody(userId: string): string | null {
  return userId === '' ? null : userId;
}

/** Where the panel can go from here: a card about the asset, or an asset it goes with. */
type Openers = Pick<AssetDetailDialogProps, 'onOpenCard' | 'onOpenAsset'>;

interface AssetFormProps extends Openers {
  readonly ref: React.Ref<HTMLFormElement>;
  /** The dialog around the form, whose height follows what the form shows. */
  readonly panel: React.RefObject<HTMLDialogElement | null>;
  readonly asset: AssetDetailView;
  readonly projectSlug: string;
  readonly onDone: () => void;
}

function AssetForm({
  ref,
  panel,
  asset,
  projectSlug,
  onDone,
  ...openers
}: AssetFormProps): React.JSX.Element {
  const [isEditing, setIsEditingNow] = useState(false);
  const [form, setForm] = useState<AssetFormState>(() => toForm(asset));
  const updateAsset = useUpdateAsset(projectSlug, asset.id);
  const problems = readFieldProblems(updateAsset.error);
  const canWrite = !asset.project.archived;
  // Only in edit mode. Reading an asset is reading it: nothing on the panel
  // changes anything until somebody has said they mean to.
  const canChange = canWrite && isEditing;
  const askToDelete = useAskToDeleteAsset(projectSlug, onDone);
  // The Overview until somebody picks a tab, and the Overview again if the tab
  // they were reading goes — deleted here, or by somebody else meanwhile.
  const [chosenTab, setChosenTabNow] = useState<string>(OVERVIEW);
  const selected = asset.tabs.some((tab) => tab.id === chosenTab) ? chosenTab : OVERVIEW;
  const tab = asset.tabs.find((each) => each.id === selected);

  // Another tab, or the same one opened for editing, is another height. The
  // panel goes there smoothly rather than jumping, so the bar somebody just
  // pressed stays where their eye is.
  const beforeResize = useHeightFollows(panel, `${selected}:${String(isEditing)}`);
  const setChosenTab = (tabId: string): void => {
    beforeResize();
    setChosenTabNow(tabId);
  };
  const setIsEditing = (editing: boolean): void => {
    beforeResize();
    setIsEditingNow(editing);
  };

  // A refetch after saving, or somebody else's change arriving, is the authority
  // on what the asset is. Keyed off `updatedAt` so typing is not interrupted by
  // an identical refetch.
  useEffect(() => {
    setForm(toForm(asset));
  }, [asset.updatedAt]);

  const stopEditing = (): void => {
    setForm(toForm(asset));
    updateAsset.reset();
    setIsEditing(false);
  };

  const submit = (): void => {
    updateAsset.mutate(fromForm(asset.id, form), {
      // Back to reading the asset, which is what saving was for. The panel
      // stays open: what was just saved is usually what somebody checks next.
      onSuccess: () => {
        setIsEditing(false);
      },
      // A problem with a field stays on that field, where the thing to change
      // is. Anything else — a refused write, a server that went away — has
      // nowhere to be but the display.
    });
  };

  return (
    <form
      ref={ref}
      className={styles.detailForm}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <PanelHead
        asset={asset}
        projectSlug={projectSlug}
        selected={selected}
        canWrite={canWrite}
        isEditing={isEditing}
        onSelect={setChosenTab}
        onEdit={() => {
          setIsEditing(true);
        }}
        onDelete={() => {
          askToDelete(asset);
        }}
        onClose={onDone}
      />

      <div className={styles.detailBody}>
        {/* The sheet stays put while the right-hand column is being edited: the
            pictures are what somebody is checking the numbers against. */}
        <AssetReferenceSheet
          assetId={asset.id}
          projectSlug={projectSlug}
          references={asset.references}
          canWrite={canChange}
        />

        <div className={styles.detailSide}>
          <Heading asset={asset} />

          {tab === undefined ? (
            <AssetOverview
              asset={asset}
              projectSlug={projectSlug}
              canWrite={canChange}
              editing={isEditing ? { form, problems, onChange: setForm } : null}
              onSelect={setChosenTab}
              {...openers}
            />
          ) : (
            <AssetTabPanel
              // Keyed, so a rename half typed on one tab does not follow
              // somebody to the next.
              key={tab.id}
              asset={asset}
              tab={tab}
              projectSlug={projectSlug}
              canWrite={canChange}
              onGone={() => {
                setChosenTab(OVERVIEW);
              }}
            />
          )}

          {canChange && (
            <div className={styles.detailActions}>
              <Button tone="go" type="submit" busy={updateAsset.isPending} busyLabel="Saving…">
                Save changes
              </Button>
              <Button tone="stop" onClick={stopEditing}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
    </form>
  );
}

interface PanelHeadProps {
  readonly asset: AssetDetailView;
  readonly projectSlug: string;
  /** The tab being read, or the Overview. */
  readonly selected: string;
  readonly canWrite: boolean;
  readonly isEditing: boolean;
  readonly onSelect: (tabId: string) => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}

/**
 * Everything about the panel itself, on one bar across the top: what the asset
 * is filed as, which part of it is open, and what can be done to it.
 *
 * The tabs are here rather than in a column, because they are how the whole
 * panel is read, the pictures included. Edit and Delete sit beside the cross
 * that closes it, as the three things done to the panel rather than in it.
 */
function PanelHead({
  asset,
  projectSlug,
  selected,
  canWrite,
  isEditing,
  onSelect,
  onEdit,
  onDelete,
  onClose,
}: PanelHeadProps): React.JSX.Element {
  return (
    <div className={styles.detailHead}>
      <span
        className={styles.detailCategory}
        style={{ '--category-color': asset.category.color } as React.CSSProperties}
      >
        <span className={styles.detailCategoryDot} aria-hidden />
        {asset.category.name}
      </span>
      {/* What it is called out loud, in the slot the design draws it in. */}
      <span className={styles.detailKey}>{asset.assetKey}</span>

      <div className={styles.detailTabs}>
        <AssetTabStrip
          assetId={asset.id}
          projectSlug={projectSlug}
          tabs={asset.tabs}
          selected={selected}
          canWrite={canWrite && isEditing}
          onSelect={onSelect}
        />
      </div>

      {canWrite && !isEditing && (
        <Button aria-label="Edit" title="Edit" onClick={onEdit}>
          <ButtonIcon>
            <PencilIcon size={14} />
          </ButtonIcon>
        </Button>
      )}
      {canWrite && !isEditing && asset.canDelete && (
        // Beside Edit, as a card's is: these are the two things somebody
        // does to the asset itself, and the red is what tells them apart.
        <Button tone="stop" aria-label="Delete asset" title="Delete asset" onClick={onDelete}>
          <ButtonIcon>
            <TrashIcon size={14} />
          </ButtonIcon>
        </Button>
      )}
      <Button aria-label="Close" title="Close" onClick={onClose}>
        <ButtonIcon>
          <CloseIcon size={14} />
        </ButtonIcon>
      </Button>
    </div>
  );
}

/** What the asset is called and which phase it is in, over whichever tab is open. */
function Heading({ asset }: { readonly asset: AssetDetailView }): React.JSX.Element {
  return (
    <AssetCard label="Asset">
      <h2 className={styles.detailName}>{asset.name}</h2>
      <div className={styles.detailStatus}>
        <span className={styles.phaseDot} data-phase={asset.phase} aria-hidden />
        <span className={styles.phaseName}>{describeAssetPhase(asset.phase)}</span>
        <span className={styles.detailStamp}>· updated {formatTimeAgo(asset.updatedAt)}</span>
      </div>
    </AssetCard>
  );
}
