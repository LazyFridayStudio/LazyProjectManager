import { useState, type ChangeEvent } from 'react';
import { describeMilestoneState, type Milestone, type MilestonePlanView } from '@lpm/shared';

import { describeFailure, readFieldProblems } from '../../api/failure-messages.js';
import { Button, Field, useDisplay, useModalDialog } from '../ui/index.js';
import {
  useCreateMilestone,
  useDeleteMilestone,
  useUpdateMilestone,
} from '../../logic/milestones/use-milestones.js';
import styles from './ReleasePlan.module.css';

export interface ReleasePlanDialogProps {
  readonly plan: MilestonePlanView;
  readonly onDone: () => void;
}

/**
 * The release plan, edited.
 *
 * A list and a form rather than one dialog per milestone: a plan is decided by
 * looking at the dates together, and a studio adding four of them should not
 * open four dialogs to do it.
 */
export function ReleasePlanDialog({ plan, onDone }: ReleasePlanDialogProps): React.JSX.Element {
  const dialog = useModalDialog(onDone);
  const [editing, setEditing] = useState<Milestone | null>(null);

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label="Release plan">
      <div className={styles.dialogBody}>
        <h2 className={styles.dialogHeading}>Release plan</h2>
        <p className={styles.dialogExplanation}>
          The dates {plan.project.name} is held to. Everything else about a milestone — what is
          done, what is left, what is stuck — is counted from the cards promised for it.
        </p>

        <ul className={styles.list}>
          {plan.milestones.map((milestone) => (
            <MilestoneRow
              key={milestone.id}
              milestone={milestone}
              isEditing={editing?.id === milestone.id}
              onEdit={() => {
                setEditing(milestone);
              }}
              onDone={() => {
                setEditing(null);
              }}
            />
          ))}
        </ul>

        {plan.milestones.length === 0 && (
          <p className={styles.empty}>
            No dates yet. A milestone is a name, a goal and two days the team can hold itself to.
          </p>
        )}

        <MilestoneForm projectId={plan.project.id} today={nextStart(plan)} />

        <div className={styles.dialogActions}>
          <Button type="button" onClick={dialog.close}>
            Done
          </Button>
        </div>
      </div>
    </dialog>
  );
}

function MilestoneRow({
  milestone,
  isEditing,
  onEdit,
  onDone,
}: {
  milestone: Milestone;
  isEditing: boolean;
  onEdit: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const remove = useDeleteMilestone();
  const display = useDisplay();

  // The cards go back to being unpromised rather than being deleted, so the
  // question is about the date rather than about the work.
  const promised = milestone.openCount + milestone.closedCount;

  if (isEditing) {
    return (
      <li className={styles.row}>
        <MilestoneForm milestone={milestone} onDone={onDone} />
      </li>
    );
  }

  return (
    <li className={styles.row}>
      <span className={styles.rowName}>
        <span className={styles.rowTitle}>{milestone.name}</span>
        {milestone.goal !== null && <span className={styles.rowGoal}>{milestone.goal}</span>}
      </span>

      <span className={styles.rowDates}>
        {milestone.startsOn} → {milestone.shipsOn}
      </span>

      <span className={styles.rowState} data-state={milestone.state}>
        {describeMilestoneState(milestone.state)}
      </span>

      <button type="button" className={styles.plain} onClick={onEdit}>
        Edit
      </button>

      <button
        type="button"
        className={styles.danger}
        onClick={() => {
          void (async () => {
            const said = await display.askToConfirm({
              question: `Drop ${milestone.name}?`,
              consequence:
                promised === 0
                  ? 'Nothing is promised for it, so no work moves.'
                  : `The ${String(promised)} card${promised === 1 ? '' : 's'} promised for it stay, without a milestone.`,
              confirmLabel: 'Drop',
            });

            if (!said) return;

            remove.mutate({ milestoneId: milestone.id }, {});
          })();
        }}
      >
        Drop
      </button>
    </li>
  );
}

/**
 * Adds a milestone, or changes one.
 *
 * The same four questions either way: a thing you can create with four and only
 * change with one is a thing people delete and remake.
 */
/**
 * The day a new milestone would start: after the last one, or today.
 *
 * A plan is usually built end to end, and retyping the date the previous
 * milestone finished is the sort of thing that puts a one-day gap in a year.
 */
function nextStart(plan: MilestonePlanView): string {
  const last = plan.milestones[plan.milestones.length - 1];

  if (last === undefined) return plan.today;

  const dayAfter = new Date(Date.parse(`${last.shipsOn}T00:00:00Z`) + 86_400_000);

  return dayAfter.toISOString().slice(0, 10);
}

/** An empty form, or one filled in from the milestone being changed. */
function toDraft(milestone: Milestone | undefined, today: string | undefined): Draft {
  if (milestone === undefined) {
    // A new milestone usually starts when the last one ended, and the caller
    // knows what day that is.
    return { name: '', goal: '', startsOn: today ?? '', shipsOn: '', capacity: '' };
  }

  return {
    name: milestone.name,
    goal: milestone.goal ?? '',
    startsOn: milestone.startsOn,
    shipsOn: milestone.shipsOn,
    capacity: milestone.capacityPoints === null ? '' : String(milestone.capacityPoints),
  };
}

/** What the command takes, which is not quite what the form holds. */
function toFields(draft: Draft) {
  const goal = draft.goal.trim();
  const capacity = draft.capacity.trim();

  return {
    name: draft.name.trim(),
    goal: goal === '' ? null : goal,
    startsOn: draft.startsOn,
    shipsOn: draft.shipsOn,
    capacityPoints: capacity === '' ? null : Number(capacity),
  };
}

interface Draft {
  name: string;
  goal: string;
  startsOn: string;
  shipsOn: string;
  capacity: string;
}

/**
 * The five answers a milestone is made of, and a way to clear them.
 *
 * Its own hook because the form is otherwise five `useState` calls and a
 * submit, and the submit is the part worth reading.
 */
function useDraft(milestone: Milestone | undefined, today: string | undefined) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(milestone, today));

  const set =
    (field: keyof Draft) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      const { value } = event.target;
      setDraft((current) => ({ ...current, [field]: value }));
    };

  return {
    draft,
    set,
    /** What the command takes, which is not quite what the form holds. */
    fields: toFields(draft),
    /** After adding one: the dates usually run on, so the start is kept. */
    clear: (): void => {
      setDraft((current) => ({ ...current, name: '', goal: '', shipsOn: '', capacity: '' }));
    },
  };
}

/**
 * Adds a milestone, or changes one.
 *
 * The same five questions either way: a thing you can create with five and only
 * change with one is a thing people delete and remake.
 */
function MilestoneForm({
  projectId,
  milestone,
  today,
  onDone,
}: {
  projectId?: string;
  milestone?: Milestone;
  today?: string;
  onDone?: () => void;
}): React.JSX.Element {
  const create = useCreateMilestone();
  const update = useUpdateMilestone();
  const display = useDisplay();
  const problems = readFieldProblems(milestone === undefined ? create.error : update.error);
  const { draft, set, fields, clear } = useDraft(milestone, today);

  const complain = {
    onError: (error: Error) => {
      // A problem with a field stays on that field; anything else has nowhere
      // to be but the display.
      if (Object.keys(readFieldProblems(error)).length === 0) {
        display.showError(describeFailure(error));
      }
    },
  };

  const submit = (): void => {
    if (milestone === undefined) {
      create.mutate({ projectId: projectId ?? '', ...fields }, { ...complain, onSuccess: clear });

      return;
    }

    update.mutate({ milestoneId: milestone.id, ...fields }, { ...complain, onSuccess: onDone });
  };

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field
        label="Milestone"
        placeholder="Vertical slice"
        value={draft.name}
        onChange={set('name')}
        problem={problems.name}
      />

      <Field
        label="Goal"
        placeholder="One sentence the team can hold itself to"
        value={draft.goal}
        onChange={set('goal')}
        problem={problems.goal}
      />

      <div className={styles.formRow}>
        <Field
          label="Starts"
          type="date"
          value={draft.startsOn}
          onChange={set('startsOn')}
          problem={problems.startsOn}
        />
        <Field
          label="Ships"
          type="date"
          value={draft.shipsOn}
          onChange={set('shipsOn')}
          problem={problems.shipsOn}
        />
        <Field
          label="Capacity (pts)"
          placeholder="46"
          hint="What the team believed it could take on."
          value={draft.capacity}
          onChange={set('capacity')}
          problem={problems.capacityPoints}
        />
      </div>

      <div className={styles.formActions}>
        <Button tone="go" type="submit">
          {milestone === undefined ? 'Add milestone' : 'Save'}
        </Button>
        {onDone !== undefined && (
          <button type="button" className={styles.plain} onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
