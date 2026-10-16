import {
  ASSET_OVERVIEW_BLOCK_KINDS,
  ASSET_PHASES,
  describeAssetPhase,
  type AssetDetailView,
  type AssetPhase,
  type AssetTabBlock,
} from '@lpm/shared';
import type { Dispatch, SetStateAction } from 'react';

import { joinClassNames } from '../../lib/join-class-names.js';
import { appendBlock } from '../../logic/markdown/index.js';
import { formatMoney } from '../../logic/projects/format-project-values.js';
import { MarkdownField, MarkdownText } from '../markdown/index.js';
import { PersonPicker } from '../projects/index.js';
import { Field, Select } from '../ui/index.js';
import { WorkLog } from '../work/index.js';
import {
  AssetBlockAdder,
  AssetBlockList,
  AssetCard,
  AssetPerson,
  type BlockPlace,
} from './AssetBlocks.js';
import tabStyles from './AssetTabs.module.css';
import { AssetFiles } from './AssetFiles.js';
import { AssetLinks } from './AssetLinks.js';
import { AssetTabsSummary, AssetTemplateActions } from './AssetTabsSummary.js';
import { AssetTags } from './AssetTags.js';
import styles from './AssetLibraryScreen.module.css';

const PHASE_OPTIONS = ASSET_PHASES.map((phase) => ({
  value: phase,
  label: describeAssetPhase(phase),
}));

/** What the asset's own fields say while it is being edited. */
export interface AssetFormState {
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

/** The form, while the asset is being edited. */
export interface OverviewEditing {
  readonly form: AssetFormState;
  readonly problems: Readonly<Record<string, string>>;
  /*
   * The setter itself, so a change can be made from what the form is at the
   * time rather than from what it was when this rendered. Two files dropped
   * into the description arrive one upload apart, and the second would
   * otherwise be written over the first.
   */
  readonly onChange: Dispatch<SetStateAction<AssetFormState>>;
}

export interface AssetOverviewProps {
  readonly asset: AssetDetailView;
  readonly projectSlug: string;
  /** Only in edit mode: reading an asset changes nothing. */
  readonly canWrite: boolean;
  /** The form while the asset is being edited, and null while it is read. */
  readonly editing: OverviewEditing | null;
  readonly onSelect: (tabId: string) => void;
  readonly onOpenCard?: ((cardId: string) => void) | undefined;
  readonly onOpenAsset?: ((assetId: string) => void) | undefined;
}

/**
 * The asset itself.
 *
 * Always what it is and who is on it — the description, the assignee and the
 * reporter — and then only what somebody has chosen to show: its cost, its
 * tabs, its tags, its files and hours, what it is linked to, notes. A thing
 * with nothing in a section has no use for the section's empty box.
 */
export function AssetOverview({
  asset,
  projectSlug,
  canWrite,
  editing,
  onSelect,
  onOpenCard,
  onOpenAsset,
}: AssetOverviewProps): React.JSX.Element {
  const place: BlockPlace = { asset, tabId: null, name: 'the Overview' };

  return (
    <>
      {editing === null ? <Core asset={asset} /> : <CoreFields asset={asset} editing={editing} />}

      <AssetBlockList
        place={place}
        blocks={asset.overview}
        projectSlug={projectSlug}
        canWrite={canWrite}
        drawSection={(block) => (
          <OverviewSection
            asset={asset}
            block={block}
            projectSlug={projectSlug}
            canWrite={canWrite}
            editing={editing}
            onSelect={onSelect}
            onOpenCard={onOpenCard}
            onOpenAsset={onOpenAsset}
          />
        )}
      />

      {canWrite && (
        <>
          <AssetBlockAdder
            place={place}
            blocks={asset.overview}
            offered={ASSET_OVERVIEW_BLOCK_KINDS}
            projectSlug={projectSlug}
          />
          <AssetTemplateActions asset={asset} projectSlug={projectSlug} />
        </>
      )}
    </>
  );
}

/** What every asset says, as it reads: what it is, who is making it, who asked. */
function Core({ asset }: { readonly asset: AssetDetailView }): React.JSX.Element {
  return (
    <>
      <AssetCard label="Description">
        <h3 className={tabStyles.blockHeading}>Description</h3>
        {asset.description === null ? (
          <p className={styles.missing}>No description provided.</p>
        ) : (
          <MarkdownText source={asset.description} />
        )}
      </AssetCard>

      <AssetCard label="People">
        <div className={tabStyles.people}>
          <AssetPerson role="Assignee" person={asset.assignee} nobody="Nobody yet" />
          <AssetPerson role="Reporter" person={asset.reporter} nobody="Unknown" />
        </div>
      </AssetCard>
    </>
  );
}

/** One section the Overview shows of the asset, drawn the way it is being read or edited. */
function OverviewSection({
  asset,
  block,
  projectSlug,
  canWrite,
  editing,
  onSelect,
  onOpenCard,
  onOpenAsset,
}: Omit<AssetOverviewProps, 'editing'> & {
  readonly block: AssetTabBlock;
  readonly editing: OverviewEditing | null;
}): React.JSX.Element | null {
  switch (block.kind) {
    case 'estimate':
      return editing === null ? (
        <Estimate asset={asset} />
      ) : (
        <EstimateFields asset={asset} editing={editing} />
      );

    case 'tabs':
      return (
        <AssetTabsSummary
          asset={asset}
          projectSlug={projectSlug}
          canWrite={canWrite}
          onOpenTab={onSelect}
        />
      );

    case 'tags':
      return (
        <AssetTags
          assetId={asset.id}
          projectSlug={projectSlug}
          tags={asset.tags}
          canWrite={canWrite}
        />
      );

    case 'files':
      return (
        <AssetFiles
          assetId={asset.id}
          projectSlug={projectSlug}
          files={asset.files}
          canWrite={canWrite}
          // So the asset's own list can say which tab a file is for.
          tabNames={new Map(asset.tabs.map((tab) => [tab.id, tab.title]))}
        />
      );

    case 'work':
      return (
        <WorkLog
          what={{ assetId: asset.id }}
          work={asset.work}
          // An asset is estimated in money rather than in time, so there is
          // nothing to hold the hours against. The total still says what it took.
          estimateMinutes={null}
          canWrite={canWrite}
        />
      );

    case 'cards':
      return <LinkedCards asset={asset} onOpenCard={onOpenCard} />;

    case 'assets':
      return (
        <AssetLinks
          asset={asset}
          projectSlug={projectSlug}
          canWrite={canWrite && asset.canLink}
          onOpenAsset={onOpenAsset}
        />
      );

    default:
      // Notes and checklists are drawn by the list itself.
      return null;
  }
}

/**
 * What the asset is estimated to cost, given its own box.
 *
 * The number a producer opens an asset to find. The line under it says what the
 * money is in and when the thing is wanted, because a bare figure with no
 * currency beside it is how two studios on the same project disagree by a
 * factor of one and a half.
 */
function Estimate({ asset }: { readonly asset: AssetDetailView }): React.JSX.Element {
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
 * The estimate's two fields, while the asset is being edited.
 *
 * Here rather than with the name and the description, because they belong to
 * the block: an asset that does not show an estimate is not asked for one.
 * Saved with the rest of the form.
 */
function EstimateFields({
  asset,
  editing,
}: {
  readonly asset: AssetDetailView;
  readonly editing: OverviewEditing;
}): React.JSX.Element {
  const { form, problems, onChange } = editing;

  return (
    <div className={styles.dialogPair}>
      <Field
        label={`Estimated cost (${asset.project.currency})`}
        value={form.cost}
        onChange={(event) => {
          const cost = event.target.value;

          onChange((current) => ({ ...current, cost }));
        }}
        problem={problems.estimatedCostMinor}
      />
      <Field
        label="Target date"
        type="date"
        value={form.dueOn}
        onChange={(event) => {
          const dueOn = event.target.value;

          onChange((current) => ({ ...current, dueOn }));
        }}
        problem={problems.dueOn}
      />
    </div>
  );
}

/**
 * The work outstanding on this asset.
 *
 * The half that makes a library worth keeping: not what a thing is, but what is
 * still to be done to it. Open cards come first, because those are the ones
 * somebody opening an asset is asking about. Linked from the card's side.
 */
function LinkedCards({
  asset,
  onOpenCard,
}: {
  readonly asset: AssetDetailView;
  readonly onOpenCard?: ((cardId: string) => void) | undefined;
}): React.JSX.Element {
  return (
    <section>
      <h3 className={styles.detailHeading}>Linked work</h3>
      {asset.cards.length === 0 ? (
        <p className={styles.missing}>No cards are about this asset yet.</p>
      ) : (
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
      )}
    </section>
  );
}

function CardSummary({
  card,
}: {
  readonly card: AssetDetailView['cards'][number];
}): React.JSX.Element {
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

/**
 * What every asset has, as a form: what it is called, which phase it is in,
 * who is making it, who asked for it, and what it is.
 */
function CoreFields({
  asset,
  editing,
}: {
  readonly asset: AssetDetailView;
  readonly editing: OverviewEditing;
}): React.JSX.Element {
  const { form, problems, onChange } = editing;
  const set = <TField extends keyof AssetFormState>(
    field: TField,
    value: AssetFormState[TField],
  ): void => {
    onChange((current) => ({ ...current, [field]: value }));
  };

  return (
    <>
      <AssetCard label="Name and phase">
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
      </AssetCard>

      <AssetCard label="People">
        {/* Both, and in this order, because the library is read the way the board
          is: who is making it is the question asked of a row, and who wanted it
          is the question asked when the brief turns out to be thin. */}
        <div className={styles.dialogPair}>
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
        </div>
      </AssetCard>

      <AssetCard label="Description">
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
      </AssetCard>
    </>
  );
}
