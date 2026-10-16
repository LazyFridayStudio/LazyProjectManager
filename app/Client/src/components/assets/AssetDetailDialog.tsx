import {
  ASSET_PHASES,
  describeAssetPhase,
  type AssetDetailView,
  type AssetPhase,
} from '@lpm/shared';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import { describeFailure, readFieldProblems } from '../../api/failure-messages.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import { appendBlock } from '../../logic/markdown/index.js';
import {
  Button,
  ButtonIcon,
  CloseIcon,
  Field,
  Loading,
  PencilIcon,
  Select,
  TrashIcon,
  useArrivesWith,
  useModalDialog,
} from '../ui/index.js';
import { MarkdownField, MarkdownText } from '../markdown/index.js';
import { AssetFiles } from './AssetFiles.js';
import { AssetLinks } from './AssetLinks.js';
import { AssetTabPanel } from './AssetTabPanel.js';
import { AssetTabsSummary } from './AssetTabsSummary.js';
import { AssetTabStrip, OVERVIEW } from './AssetTabStrip.js';
import { AssetTags } from './AssetTags.js';
import {
  formatMoney,
  formatTimeAgo,
  toMinorUnits,
} from '../../logic/projects/format-project-values.js';
import { AssetReferenceSheet } from './AssetReferenceSheet.js';
import { useAsset, useUpdateAsset, type UpdateAssetInput } from '../../logic/assets/use-assets.js';
import { useAskToDeleteAsset } from '../../logic/assets/use-delete-asset.js';
import { PersonPicker } from '../projects/index.js';
import styles from './AssetLibraryScreen.module.css';
import { WorkLog } from '../work/index.js';

const PHASE_OPTIONS = ASSET_PHASES.map((phase) => ({
  value: phase,
  label: describeAssetPhase(phase),
}));

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

interface AssetFormState {
  name: string;
  phase: AssetPhase;
  cost: string;
  dueOn: string;
  description: string;
  /** Empty string is "nobody yet", which a select cannot express as null. */
  assigneeId: string;
  /** Empty string is an asset nobody was recorded as asking for. */
  reporterId: string;
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
  readonly asset: AssetDetailView;
  readonly projectSlug: string;
  readonly onDone: () => void;
}

function AssetForm({
  ref,
  asset,
  projectSlug,
  onDone,
  ...openers
}: AssetFormProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
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
  const [chosenTab, setChosenTab] = useState<string>(OVERVIEW);
  const selected = asset.tabs.some((tab) => tab.id === chosenTab) ? chosenTab : OVERVIEW;
  const tab = asset.tabs.find((each) => each.id === selected);

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
            <Overview
              asset={asset}
              projectSlug={projectSlug}
              canWrite={canChange}
              onSelect={setChosenTab}
              editing={
                isEditing ? (
                  <Editing form={form} problems={problems} asset={asset} onChange={setForm} />
                ) : null
              }
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
    <div>
      <h2 className={styles.detailName}>{asset.name}</h2>
      <div className={styles.detailStatus}>
        <span className={styles.phaseDot} data-phase={asset.phase} aria-hidden />
        <span className={styles.phaseName}>{describeAssetPhase(asset.phase)}</span>
        <span className={styles.detailStamp}>· updated {formatTimeAgo(asset.updatedAt)}</span>
      </div>
    </div>
  );
}

interface OverviewProps extends Openers {
  readonly asset: AssetDetailView;
  readonly projectSlug: string;
  /** Only in edit mode: reading an asset changes nothing. */
  readonly canWrite: boolean;
  readonly onSelect: (tabId: string) => void;
  /**
   * The asset's own fields as a form, while it is being edited, in place of
   * the estimate, the description and the facts they would otherwise be read
   * as. Null while it is being read.
   */
  readonly editing: React.ReactNode;
}

/**
 * The asset itself: what it costs, what it is, the jobs it is broken into, and
 * everything filed against it whichever job it was for.
 */
function Overview({
  asset,
  projectSlug,
  canWrite,
  onSelect,
  editing,
  onOpenCard,
  onOpenAsset,
}: OverviewProps): React.JSX.Element {
  // So the asset's own lists can say which tab a file is for.
  const tabNames = new Map(asset.tabs.map((tab) => [tab.id, tab.title]));

  return (
    <>
      {editing ?? <About asset={asset} />}

      <AssetTabsSummary
        asset={asset}
        projectSlug={projectSlug}
        canWrite={canWrite}
        onOpenTab={onSelect}
      />

      <AssetTags
        assetId={asset.id}
        projectSlug={projectSlug}
        tags={asset.tags}
        canWrite={canWrite}
      />

      {editing === null && <Facts asset={asset} />}

      <AssetFiles
        assetId={asset.id}
        projectSlug={projectSlug}
        files={asset.files}
        canWrite={canWrite}
        tabNames={tabNames}
      />

      <WorkLog
        what={{ assetId: asset.id }}
        work={asset.work}
        // An asset is estimated in money rather than in time, so there is
        // nothing to hold the hours against. The total still says what it took.
        estimateMinutes={null}
        canWrite={canWrite}
      />

      <LinkedCards asset={asset} onOpenCard={onOpenCard} />

      <AssetLinks
        asset={asset}
        projectSlug={projectSlug}
        canWrite={canWrite && asset.canLink}
        onOpenAsset={onOpenAsset}
      />
    </>
  );
}

/** What it costs and what it is, as they read. */
function About({ asset }: { readonly asset: AssetDetailView }): React.JSX.Element {
  return (
    <>
      <Estimate asset={asset} />

      <section>
        <h3 className={styles.detailHeading}>Description</h3>
        {asset.description === null ? (
          <p className={styles.missing}>No description provided.</p>
        ) : (
          <MarkdownText source={asset.description} />
        )}
      </section>
    </>
  );
}

/** Label on the left, value on the right: the asset's facts as they read. */
function Facts({ asset }: { readonly asset: AssetDetailView }): React.JSX.Element {
  return (
    <dl className={styles.facts}>
      <Fact label="Category" value={asset.category.name} />
      <Fact label="Phase" value={describeAssetPhase(asset.phase)} />
      <Fact
        label="Estimated cost"
        value={
          asset.estimatedCostMinor === null
            ? null
            : formatMoney(asset.estimatedCostMinor, asset.project.currency)
        }
      />
      <Fact label="Target date" value={asset.dueOn} />
      <Fact label="Assignee" value={asset.assignee?.displayName ?? null} />
      <Fact label="Reporter" value={asset.reporter?.displayName ?? null} />
      <Fact label="Reference images" value={String(asset.references.length)} />
    </dl>
  );
}

/**
 * What the asset is estimated to cost, given its own box.
 *
 * The number a producer opens an asset to find. The line under it says what the
 * money is in and when the thing is wanted, because a bare figure with no
 * currency beside it is how two studios on the same project disagree by a
 * factor of one and a half.
 */
function Estimate({ asset }: { asset: AssetDetailView }): React.JSX.Element {
  return (
    <div className={styles.estimate}>
      <div className={styles.estimateLabel}>Estimated cost</div>
      <div className={styles.estimateValue}>
        {asset.estimatedCostMinor === null
          ? 'Not estimated'
          : formatMoney(asset.estimatedCostMinor, asset.project.currency)}
      </div>
      <div className={styles.estimateNote}>
        {asset.project.currency}
        {asset.dueOn === null ? '' : ` · wanted by ${asset.dueOn}`}
      </div>
    </div>
  );
}

/**
 * The work outstanding on this asset.
 *
 * The half that makes a library worth keeping: not what a thing is, but what is
 * still to be done to it. Open cards come first, because those are the ones
 * somebody opening an asset is asking about.
 */
function LinkedCards({
  asset,
  onOpenCard,
}: {
  asset: AssetDetailView;
  onOpenCard?: (cardId: string) => void;
}): React.JSX.Element | null {
  if (asset.cards.length === 0) {
    return null;
  }

  return (
    <section>
      <h3 className={styles.detailHeading}>Linked work</h3>
      <ul className={styles.cardList}>
        {asset.cards.map((card) => (
          <li key={card.linkId} className={styles.cardRow}>
            {onOpenCard === undefined ? (
              <CardSummary card={card} />
            ) : (
              <button
                type="button"
                className={styles.cardOpen}
                onClick={() => {
                  onOpenCard(card.cardId);
                }}
              >
                <CardSummary card={card} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CardSummary({ card }: { card: AssetDetailView['cards'][number] }): React.JSX.Element {
  return (
    <>
      <span className={styles.cardKey}>{card.cardKey}</span>
      <span className={styles.cardTitle} data-closed={card.closed}>
        {card.title}
      </span>
      <span className={styles.cardState}>{card.closed ? 'Done' : 'Open'}</span>
    </>
  );
}

/** A value, or a dash — an empty row is harder to read than one that says so. */
function Fact({ label, value }: { label: string; value: string | null }): React.JSX.Element {
  return (
    <>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>{value ?? '—'}</dd>
    </>
  );
}

interface EditingProps {
  readonly form: AssetFormState;
  readonly problems: Readonly<Record<string, string>>;
  /** The asset as it stands: the currency to price it in, and who is on it. */
  readonly asset: AssetDetailView;
  /*
   * The setter itself, so a change can be made from what the form is at the
   * time rather than from what it was when this rendered. Two files dropped
   * into the description arrive one upload apart, and the second would
   * otherwise be written over the first.
   */
  readonly onChange: Dispatch<SetStateAction<AssetFormState>>;
}

function Editing({ form, problems, asset, onChange }: EditingProps): React.JSX.Element {
  const set = <TField extends keyof AssetFormState>(
    field: TField,
    value: AssetFormState[TField],
  ): void => {
    onChange((current) => ({ ...current, [field]: value }));
  };

  return (
    <>
      <Field
        label="Name"
        autoFocus
        value={form.name}
        onChange={(event) => {
          set('name', event.target.value);
        }}
        problem={problems.name}
      />

      <div className={styles.dialogPair}>
        <Select
          label="Phase"
          options={PHASE_OPTIONS}
          value={form.phase}
          onChange={(event) => {
            set('phase', event.target.value as AssetPhase);
          }}
        />
      </div>

      <div className={styles.dialogPair}>
        <Field
          label={`Estimated cost (${asset.project.currency})`}
          value={form.cost}
          onChange={(event) => {
            set('cost', event.target.value);
          }}
          problem={problems.estimatedCostMinor}
        />
        <Field
          label="Target date"
          type="date"
          value={form.dueOn}
          onChange={(event) => {
            set('dueOn', event.target.value);
          }}
          problem={problems.dueOn}
        />
      </div>

      {/* Both, and in this order, because the library is read the way the board
          is: who is making it is the question asked of a row, and who wanted it
          is the question asked when the brief turns out to be thin. */}
      <PersonPicker
        label="Assignee"
        nobody="Nobody yet"
        projectId={asset.project.id}
        value={form.assigneeId}
        was={asset.assignee}
        problem={problems.assignee}
        onChange={(event) => {
          set('assigneeId', event.target.value);
        }}
      />

      <PersonPicker
        label="Reporter"
        nobody="Unknown"
        projectId={asset.project.id}
        value={form.reporterId}
        was={asset.reporter}
        problem={problems.reporter}
        onChange={(event) => {
          set('reporterId', event.target.value);
        }}
      />

      {/* Not a `label`, because the field has buttons of its own and a label
          wrapping them would press one every time somebody clicked it. The box
          names itself instead. */}
      <div className={styles.detailDescription}>
        <span className={styles.dialogLabel}>Description</span>
        <MarkdownField
          label="Description"
          className={joinClassNames(styles.dialogTextArea, styles.detailDescriptionBox)}
          value={form.description}
          files={{
            uploadTo: { kind: 'assetFile', assetId: asset.id },
            onInsert: (markdown: string) => {
              onChange((current) => ({
                ...current,
                description: appendBlock(current.description, markdown),
              }));
            },
          }}
          onChange={(event) => {
            set('description', event.target.value);
          }}
          onReplace={(next: string) => {
            set('description', next);
          }}
        />
      </div>
    </>
  );
}
