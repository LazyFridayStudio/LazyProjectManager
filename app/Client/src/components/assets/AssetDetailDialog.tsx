import {
  ASSET_STATUSES,
  describeAssetStatus,
  type AssetDetailView,
  type AssetStatus,
} from '@lpm/shared';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import { describeFailure, readFieldProblems } from '../../api/failure-messages.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import { appendBlock } from '../../logic/markdown/index.js';
import {
  Button,
  ButtonIcon,
  Field,
  Loading,
  PencilIcon,
  Select,
  useModalDialog,
} from '../ui/index.js';
import { MarkdownField, MarkdownText } from '../markdown/index.js';
import { AssetFiles } from './AssetFiles.js';
import { AssetSubtasks } from './AssetSubtasks.js';
import { AssetTags } from './AssetTags.js';
import {
  formatMoney,
  formatTimeAgo,
  toMinorUnits,
} from '../../logic/projects/format-project-values.js';
import { AssetReferenceSheet } from './AssetReferenceSheet.js';
import { useAsset, useUpdateAsset } from '../../logic/assets/use-assets.js';
import { PersonPicker } from '../projects/index.js';
import styles from './AssetLibraryScreen.module.css';
import { WorkLog } from '../work/index.js';

const STATUS_OPTIONS = ASSET_STATUSES.map((status) => ({
  value: status,
  label: describeAssetStatus(status),
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
}: AssetDetailDialogProps): React.JSX.Element {
  const dialog = useModalDialog(onClose);
  const asset = useAsset(assetId);

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
          asset={asset.data}
          projectSlug={projectSlug}
          onDone={dialog.close}
          onOpenCard={onOpenCard}
        />
      )}
    </dialog>
  );
}

interface AssetFormState {
  name: string;
  status: AssetStatus;
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
    status: asset.status,
    cost: asset.estimatedCostMinor === null ? '' : String(asset.estimatedCostMinor / 100),
    dueOn: asset.dueOn ?? '',
    description: asset.description ?? '',
    assigneeId: asset.assignee?.userId ?? '',
    reporterId: asset.reporter?.userId ?? '',
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

interface AssetFormProps {
  readonly asset: AssetDetailView;
  readonly projectSlug: string;
  readonly onDone: () => void;
  readonly onOpenCard?: (cardId: string) => void;
}

function AssetForm({ asset, projectSlug, onDone, onOpenCard }: AssetFormProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<AssetFormState>(() => toForm(asset));
  const updateAsset = useUpdateAsset(projectSlug, asset.id);
  const problems = readFieldProblems(updateAsset.error);
  const canWrite = !asset.project.archived;

  // A refetch after saving, or somebody else's change arriving, is the authority
  // on what the asset is. Keyed off `updatedAt` so typing is not interrupted by
  // an identical refetch.
  useEffect(() => {
    setForm(toForm(asset));
  }, [asset.updatedAt]);

  const submit = (): void => {
    updateAsset.mutate(
      {
        assetId: asset.id,
        name: form.name.trim(),
        status: form.status,
        estimatedCostMinor: form.cost.trim() === '' ? null : toMinorUnits(form.cost),
        dueOn: form.dueOn === '' ? null : form.dueOn,
        description: form.description.trim() === '' ? null : form.description,
        assigneeId: chosenOrNobody(form.assigneeId),
        reporterId: chosenOrNobody(form.reporterId),
      },
      {
        onSuccess: onDone,
        // A problem with a field stays on that field, where the thing to change
        // is. Anything else — a refused write, a server that went away — has
        // nowhere to be but the display.
      },
    );
  };

  return (
    <form
      className={styles.detailForm}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
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
        <Button onClick={onDone}>Close</Button>
      </div>

      <div className={styles.detailBody}>
        {/* The sheet stays put while the right-hand column is being edited: the
            pictures are what somebody is checking the numbers against. */}
        <AssetReferenceSheet
          assetId={asset.id}
          projectSlug={projectSlug}
          references={asset.references}
          canWrite={canWrite}
        />

        <div className={styles.detailSide}>
          {isEditing ? (
            <Editing form={form} problems={problems} asset={asset} onChange={setForm} />
          ) : (
            <Reading
              asset={asset}
              projectSlug={projectSlug}
              canWrite={canWrite}
              onOpenCard={onOpenCard}
            />
          )}

          <div className={styles.detailActions}>
            {canWrite && !isEditing && (
              <>
                <Advance asset={asset} projectSlug={projectSlug} />
                <Button
                  aria-label="Edit"
                  title="Edit"
                  onClick={() => {
                    setIsEditing(true);
                  }}
                >
                  <ButtonIcon>
                    <PencilIcon size={14} />
                  </ButtonIcon>
                </Button>
              </>
            )}
            {canWrite && isEditing && (
              <>
                <Button tone="go" type="submit" busy={updateAsset.isPending} busyLabel="Saving…">
                  Save changes
                </Button>
                <Button
                  tone="stop"
                  onClick={() => {
                    setForm(toForm(asset));
                    setIsEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

interface ReadingProps {
  readonly asset: AssetDetailView;
  readonly projectSlug: string;
  readonly canWrite: boolean;
  readonly onOpenCard?: (cardId: string) => void;
}

/** The asset as it reads, which is what opening one is usually for. */
function Reading({ asset, projectSlug, canWrite, onOpenCard }: ReadingProps): React.JSX.Element {
  return (
    <>
      <div>
        <h2 className={styles.detailName}>{asset.name}</h2>
        <div className={styles.detailStatus}>
          <span className={styles.statusDot} data-status={asset.status} aria-hidden />
          <span className={styles.statusName}>{describeAssetStatus(asset.status)}</span>
          <span className={styles.detailStamp}>· updated {formatTimeAgo(asset.updatedAt)}</span>
        </div>
      </div>

      <Estimate asset={asset} />

      <section>
        <h3 className={styles.detailHeading}>Description</h3>
        {asset.description === null ? (
          <p className={styles.missing}>No description provided.</p>
        ) : (
          <MarkdownText source={asset.description} />
        )}
      </section>

      <AssetSubtasks
        assetId={asset.id}
        projectSlug={projectSlug}
        subtasks={asset.subtasks}
        canWrite={canWrite}
      />

      <AssetTags
        assetId={asset.id}
        projectSlug={projectSlug}
        tags={asset.tags}
        canWrite={canWrite}
      />

      <dl className={styles.facts}>
        <Fact label="Category" value={asset.category.name} />
        <Fact label="Status" value={describeAssetStatus(asset.status)} />
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

      <AssetFiles
        assetId={asset.id}
        projectSlug={projectSlug}
        files={asset.files}
        canWrite={canWrite}
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
    </>
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
 * Moves the asset on to the next stage of being made.
 *
 * An asset goes through the same five stages everywhere, so unlike a card there
 * is always exactly one thing "onwards" means — which is why this is one button
 * and not the strip of lists a card gets.
 *
 * Live outside edit mode, as the card's is: it changes how far along a thing is
 * rather than what it says, and making somebody open a form to say a model has
 * been approved is how a library stops being kept up to date.
 */
function Advance({
  asset,
  projectSlug,
}: {
  asset: AssetDetailView;
  projectSlug: string;
}): React.JSX.Element | null {
  const updateAsset = useUpdateAsset(projectSlug, asset.id);
  const next = ASSET_STATUSES[ASSET_STATUSES.indexOf(asset.status) + 1];

  if (next === undefined) {
    // Final. There is nowhere further for a finished thing to go.
    return null;
  }

  return (
    <Button
      tone="go"
      busy={updateAsset.isPending}
      busyLabel="Saving…"
      onClick={() => {
        updateAsset.mutate({ assetId: asset.id, status: next }, {});
      }}
    >
      {`Mark ${describeAssetStatus(next).toLowerCase()}`}
    </Button>
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
          label="Status"
          options={STATUS_OPTIONS}
          value={form.status}
          onChange={(event) => {
            set('status', event.target.value as AssetStatus);
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
