import {
  CARD_PRIORITIES,
  CARD_TYPES,
  describeCardPriority,
  describeCardType,
  type CardDetailView,
} from '@lpm/shared';

import { describeFailure, readFieldProblems } from '../../../api/failure-messages.js';
import { joinClassNames } from '../../../lib/join-class-names.js';
import { getColorForCardType } from '../../../tokens/card-type-colors.js';
import {
  Button,
  ButtonIcon,
  Field,
  Loading,
  PencilIcon,
  Select,
  TrashIcon,
  useModalDialog,
} from '../../ui/index.js';
import { useMilestonePlan } from '../../../logic/milestones/use-milestones.js';
import { PersonPicker } from '../../projects/index.js';
import { formatTimeAgo } from '../../../logic/projects/format-project-values.js';
import { useState } from 'react';

import { useCardDetail } from '../../../logic/board/use-cards.js';
import { useAskToDeleteCard } from '../../../logic/board/use-delete-card.js';
import { MarkdownField, MarkdownText } from '../../markdown/index.js';
import { CardActivity } from './CardActivity.js';
import { WorkLog } from '../../work/index.js';
import { CardWorkflow } from './CardWorkflow.js';
import styles from './CardDetailDialog.module.css';
import {
  useCardForm,
  type CardForm,
  type FieldEvent,
} from '../../../logic/board/card-detail/use-card-form.js';

const TYPE_OPTIONS = CARD_TYPES.map((cardType) => ({
  value: cardType,
  label: describeCardType(cardType),
}));

const PRIORITY_OPTIONS = [
  { value: '', label: '— none' },
  ...CARD_PRIORITIES.map((priority) => ({
    value: priority,
    label: describeCardPriority(priority),
  })),
];

export interface CardDetailDialogProps {
  readonly cardId: string;
  readonly projectSlug: string;
  readonly canWrite: boolean;
  readonly onClose: () => void;
  /** Follows a link to another card, in this panel rather than a new one. */
  readonly onOpenCard: (cardId: string) => void;
  /** Opens an asset this card is about, over the screen the card is on. */
  readonly onOpenAsset: (assetId: string) => void;
}

/**
 * One card, opened over the board.
 *
 * A modal rather than a route, as `SCREENS.md` asks: closing it puts somebody
 * back exactly where they were, with the board still scrolled where they left
 * it.
 */
export function CardDetailDialog({
  cardId,
  projectSlug,
  canWrite,
  onClose,
  onOpenCard,
  onOpenAsset,
}: CardDetailDialogProps): React.JSX.Element {
  const dialog = useModalDialog(onClose);
  const card = useCardDetail(cardId);

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label="Card">
      {card.isPending && <Loading what="Loading the card" />}
      {card.isError && (
        <p className={styles.message} role="alert">
          {describeFailure(card.error)}
        </p>
      )}
      {card.isSuccess && (
        <CardForm
          // Keyed by the card, so following a link starts the next one as it
          // opens rather than carrying this one's half-finished edit into it.
          key={card.data.id}
          card={card.data}
          projectSlug={projectSlug}
          canWrite={canWrite}
          onDone={dialog.close}
          onOpenCard={onOpenCard}
          onOpenAsset={onOpenAsset}
        />
      )}
    </dialog>
  );
}

interface CardFormProps {
  readonly card: CardDetailView;
  readonly projectSlug: string;
  readonly canWrite: boolean;
  readonly onDone: () => void;
  readonly onOpenCard: (cardId: string) => void;
  readonly onOpenAsset: (assetId: string) => void;
}

function CardForm({
  card,
  projectSlug,
  canWrite,
  onDone,
  onOpenCard,
  onOpenAsset,
}: CardFormProps): React.JSX.Element {
  /**
   * A card opens to be read.
   *
   * Most times a card is opened it is to find something out, not to change it —
   * and a panel full of live inputs invites a stray keystroke into somebody
   * else's work. Editing is asked for.
   */
  const [isEditing, setIsEditing] = useState(false);
  const askToDelete = useAskToDeleteCard(projectSlug, onDone);
  const { form, update, insert, replace, save, isSaving, error } = useCardForm(
    card,
    projectSlug,
    onDone,
  );
  const problems = readFieldProblems(error);
  const disabled = !canWrite || !isEditing;

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div
        className={styles.head}
        style={{ '--type-color': getColorForCardType(card.type) } as React.CSSProperties}
      >
        <span className={styles.typeDot} aria-hidden />
        <span className={styles.key}>{card.cardKey}</span>
        <div className={styles.closeButton}>
          <Button onClick={onDone}>Close</Button>
        </div>
      </div>

      <div className={styles.columns}>
        <CardProse
          card={card}
          projectSlug={projectSlug}
          form={form}
          canWrite={canWrite}
          disabled={disabled}
          update={update}
          insert={insert}
          replace={replace}
          onOpenCard={onOpenCard}
          onOpenAsset={onOpenAsset}
        />

        <CardFieldRail
          card={card}
          form={form}
          update={update}
          disabled={disabled}
          problems={problems}
        />
      </div>

      <div className={styles.footer}>
        {canWrite && !isEditing && (
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
        )}
        {canWrite && card.canDelete && !isEditing && (
          // Beside Edit, because these are the two things somebody does to the
          // card itself, and the red is what tells them apart.
          <Button
            tone="stop"
            aria-label="Delete card"
            title="Delete card"
            onClick={() => {
              askToDelete(card);
            }}
          >
            <ButtonIcon>
              <TrashIcon size={14} />
            </ButtonIcon>
          </Button>
        )}
        {canWrite && isEditing && (
          <>
            <Button tone="go" type="submit" busy={isSaving} busyLabel="Saving…">
              Save changes
            </Button>
            <Button
              tone="stop"
              onClick={() => {
                setIsEditing(false);
              }}
            >
              Cancel
            </Button>
          </>
        )}
        <span className={styles.stamp}>Updated {formatTimeAgo(card.updatedAt)}</span>
      </div>
    </form>
  );
}

interface CardFieldRailProps {
  readonly card: CardDetailView;
  readonly form: CardForm;
  readonly update: (field: keyof CardForm) => (event: FieldEvent) => void;
  readonly disabled: boolean;
  readonly problems: Readonly<Record<string, string>>;
}

/** Everything about the card that is a value rather than prose. */
function CardFieldRail({
  card,
  form,
  update,
  disabled,
  problems,
}: CardFieldRailProps): React.JSX.Element {
  return (
    <div className={styles.rail}>
      <h3 className={styles.sectionHeading}>Fields</h3>

      <div className={styles.pair}>
        <Select
          label="Type"
          options={TYPE_OPTIONS}
          value={form.type}
          disabled={disabled}
          onChange={update('type')}
        />
        <Select
          label="Priority"
          options={PRIORITY_OPTIONS}
          value={form.priority}
          disabled={disabled}
          onChange={update('priority')}
        />
      </div>

      <div className={styles.pair}>
        <Field
          label="Points"
          type="number"
          min={0}
          step={1}
          value={form.points}
          disabled={disabled}
          onChange={update('points')}
          problem={problems.points}
        />
        <Field
          label="Estimate"
          placeholder="2d 4h"
          value={form.estimate}
          disabled={disabled}
          onChange={update('estimate')}
          hint="2d 4h, 3h, 45m"
          problem={problems.estimateMinutes}
        />
      </div>

      <Field
        label="Due"
        type="date"
        value={form.dueOn}
        disabled={disabled}
        onChange={update('dueOn')}
        problem={problems.dueOn}
      />

      <MilestonePicker
        projectSlug={card.projectSlug}
        value={form.milestoneId}
        disabled={disabled}
        onChange={update('milestoneId')}
        problem={problems.milestoneId}
      />

      <div className={styles.pair}>
        <Field
          label="Discipline"
          placeholder="Environment"
          value={form.discipline}
          disabled={disabled}
          onChange={update('discipline')}
        />
        <Field
          label="Fix version"
          placeholder="0.9.4"
          value={form.fixVersion}
          disabled={disabled}
          onChange={update('fixVersion')}
        />
      </div>

      <PersonPicker
        label="Assignee"
        nobody="Nobody yet"
        projectId={card.projectId}
        value={form.assigneeId}
        was={card.assignee}
        disabled={disabled}
        problem={problems.assignee}
        onChange={update('assigneeId')}
      />

      <PersonPicker
        label="Reporter"
        nobody="Unknown"
        projectId={card.projectId}
        value={form.reporterId}
        was={card.reporter}
        disabled={disabled}
        problem={problems.reporter}
        onChange={update('reporterId')}
      />
    </div>
  );
}

/** What somebody wrote, or a note saying that nobody has. */
function WrittenDescription({ source }: { source: string }): React.JSX.Element {
  if (source.trim() === '') {
    return <p className={styles.missing}>No description provided.</p>;
  }

  return <MarkdownText source={source} />;
}

interface CardProseProps {
  readonly card: CardDetailView;
  readonly projectSlug: string;
  readonly form: CardForm;
  /** Whether this card can be changed at all, apart from whether Edit is on. */
  readonly canWrite: boolean;
  readonly disabled: boolean;
  readonly update: (field: keyof CardForm) => (event: FieldEvent) => void;
  readonly insert: (field: keyof CardForm, text: string) => void;
  readonly replace: (field: keyof CardForm, value: string) => void;
  readonly onOpenCard: (cardId: string) => void;
  readonly onOpenAsset: (assetId: string) => void;
}

/** The prose half of a card: what it is, and what done looks like. */
function CardProse({
  card,
  projectSlug,
  form,
  canWrite,
  disabled,
  update,
  insert,
  replace,
  onOpenCard,
  onOpenAsset,
}: CardProseProps): React.JSX.Element {
  return (
    <div className={styles.main}>
      {/* Where the card is on the board, and the way to move it. */}
      <CardWorkflow card={card} projectSlug={projectSlug} canWrite={canWrite} />

      <div className={styles.labelled}>
        {/* Only while editing: at this size the title says what it is. */}
        {!disabled && <h3 className={styles.sectionHeading}>Title</h3>}
        <input
          className={styles.titleInput}
          aria-label="Title"
          value={form.title}
          disabled={disabled}
          onChange={update('title')}
        />
      </div>

      {/* Shown even when there is nothing in it, unlike the sections below.
          A card with no links is a card with no links; a card with nobody
          having said what it is for is a card somebody has to finish. */}
      <div className={styles.labelled}>
        <h3 className={styles.sectionHeading}>Description</h3>
        {disabled ? (
          <WrittenDescription source={form.description} />
        ) : (
          <MarkdownField
            label="Description"
            className={joinClassNames(styles.textArea, styles.descriptionArea)}
            value={form.description}
            files={{
              uploadTo: { kind: 'cardAttachment', cardId: card.id },
              onInsert: (markdown: string) => {
                insert('description', markdown);
              },
            }}
            onChange={update('description')}
            onReplace={(next: string) => {
              replace('description', next);
            }}
          />
        )}
      </div>

      {/* A heading over nothing, with no way to write anything, says only that
          the card is empty — which the space it takes says better. */}
      {(!disabled || form.acceptanceCriteria !== '') && (
        <div className={styles.labelled}>
          <h3 className={styles.sectionHeading}>Acceptance criteria</h3>
          {disabled ? (
            /* Each criterion is a list item, drawn with the empty square that
               says it is a condition rather than a bullet. */
            <div className={styles.criteria}>
              <MarkdownText source={form.acceptanceCriteria} />
            </div>
          ) : (
            <MarkdownField
              label="Acceptance criteria"
              className={joinClassNames(styles.textArea, styles.criteriaArea)}
              value={form.acceptanceCriteria}
              files={{
                uploadTo: { kind: 'cardAttachment', cardId: card.id },
                onInsert: (markdown: string) => {
                  insert('acceptanceCriteria', markdown);
                },
              }}
              onChange={update('acceptanceCriteria')}
              onReplace={(next: string) => {
                replace('acceptanceCriteria', next);
              }}
            />
          )}
        </div>
      )}

      {/* Read mode changes nothing about the card — not a step, not a link,
          not a file. Editing is one state, and half of it being live is how
          somebody changes a card they only meant to look at.

          The conversation is the exception, and it is not one of those things:
          a comment appends rather than changes, and having something to say is
          what reading a card leads to. Pressing Edit to type a sentence armed
          every field on the panel to do it. */}
      {/* And the hours, which are live for the same reason the conversation
          is: coming to a card to say what you did today is the whole errand. */}
      <WorkLog
        what={{ cardId: card.id }}
        work={card.work}
        estimateMinutes={card.estimateMinutes}
        canWrite={canWrite}
      />

      <CardActivity
        card={card}
        projectSlug={projectSlug}
        canEdit={!disabled}
        canComment={canWrite}
        onOpenCard={onOpenCard}
        onOpenAsset={onOpenAsset}
      />
    </div>
  );
}

/**
 * Which milestone this card is promised for.
 *
 * Its own component because it needs the plan, and the rail is otherwise a list
 * of fields that need nothing. `Unassigned` is first and is the normal state:
 * most work has to happen without being promised for a date, and a picker that
 * insisted would be one where every card ends up on whatever milestone is
 * running.
 */
function MilestonePicker({
  projectSlug,
  value,
  disabled,
  onChange,
  problem,
}: {
  projectSlug: string;
  value: string;
  disabled: boolean;
  onChange: (event: FieldEvent) => void;
  problem?: string | undefined;
}): React.JSX.Element | null {
  const plan = useMilestonePlan(projectSlug);

  // Nothing at all until the plan arrives, and nothing if the project has no
  // dates: an empty dropdown is a control that looks broken.
  if (plan.data === undefined || plan.data.milestones.length === 0) {
    return null;
  }

  const options = [
    { value: '', label: 'No milestone' },
    ...plan.data.milestones.map((milestone) => ({
      value: milestone.id,
      label: milestone.state === 'active' ? `${milestone.name} · running` : milestone.name,
    })),
  ];

  return (
    <Select
      label="Milestone"
      options={options}
      value={value}
      disabled={disabled}
      onChange={onChange}
      problem={problem}
    />
  );
}
