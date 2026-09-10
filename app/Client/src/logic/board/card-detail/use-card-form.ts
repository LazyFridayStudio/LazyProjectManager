import {
  formatDuration,
  parseDuration,
  type CardDetailView,
  type CardPriority,
  type CardType,
} from '@lpm/shared';
import { useEffect, useState, type ChangeEvent } from 'react';

import { useDisplay } from '../../../components/ui/index.js';
import { useUpdateCard } from '../use-cards.js';
import { appendBlock } from '../../markdown/index.js';

export interface CardForm {
  title: string;
  description: string;
  acceptanceCriteria: string;
  type: CardType;
  /** Empty string is "no priority", which a select cannot express as null. */
  priority: string;
  points: string;
  estimate: string;
  dueOn: string;
  discipline: string;
  fixVersion: string;
  /** Empty string is "no milestone", which a select cannot express as null. */
  milestoneId: string;
  /** Empty string is "nobody yet", for the same reason. */
  assigneeId: string;
  /** Empty string is a reporter whose account has since been removed. */
  reporterId: string;
}

export type FieldEvent = ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;

export interface CardFormState {
  readonly form: CardForm;
  readonly isSaving: boolean;
  readonly error: Error | null;
  update: (field: keyof CardForm) => (event: FieldEvent) => void;
  /** Appends to a field, for a file dropped into it. */
  insert: (field: keyof CardForm, text: string) => void;
  /** Replaces a field outright, for a drag that rewrote the markdown. */
  replace: (field: keyof CardForm, value: string) => void;
  save: () => void;
}

/**
 * The state behind the card detail panel, kept apart from the markup.
 *
 * The estimate is the reason this is more than `useState`: it is typed as
 * `2d 4h` and carried as minutes, so it is parsed on the way out and formatted
 * on the way in.
 */
export function useCardForm(
  card: CardDetailView,
  projectSlug: string,
  onSaved: () => void,
): CardFormState {
  const [form, setForm] = useState<CardForm>(() => toForm(card));
  const [estimateProblem, setEstimateProblem] = useState<Error | null>(null);
  const updateCard = useUpdateCard(projectSlug);
  const { showInfo } = useDisplay();

  // A refetch after saving, or somebody else's change arriving, is the authority
  // on what the card is. Keyed off `updatedAt` so typing is not interrupted by
  // an identical refetch.
  useEffect(() => {
    setForm(toForm(card));
  }, [card.updatedAt]);

  return {
    form,
    isSaving: updateCard.isPending,
    error: estimateProblem ?? (updateCard.isError ? updateCard.error : null),

    update:
      (field: keyof CardForm) =>
      (event: FieldEvent): void => {
        const { value } = event.target;
        setForm((current) => ({ ...current, [field]: value }));
      },

    insert: (field: keyof CardForm, text: string): void => {
      setForm((current) => ({ ...current, [field]: appendBlock(current[field], text) }));
    },

    replace: (field: keyof CardForm, value: string): void => {
      setForm((current) => ({ ...current, [field]: value }));
    },

    save: (): void => {
      const estimate = parseDuration(form.estimate);

      if (!estimate.ok) {
        setEstimateProblem(new EstimateError(estimate.reason));
        return;
      }

      setEstimateProblem(null);
      updateCard.mutate(
        toEdit(card.id, form, estimate.minutes),
        /*
         * The panel is finished with once the change has landed; leaving it
         * open over a board that has already changed is the thing to avoid.
         *
         * Which is why the save says so in the corner rather than in the panel:
         * by the time there was anything to say, the panel it would have been
         * said in has closed.
         */
        {
          onSuccess: () => {
            showInfo('Card saved.');
            onSaved();
          },
        },
      );
    },
  };
}

/** Carries the field name so the panel can show it against the estimate input. */
class EstimateError extends Error {
  readonly fields: Readonly<Record<string, string>>;

  constructor(reason: string) {
    super(reason);
    this.name = 'EstimateError';
    this.fields = { estimateMinutes: reason };
  }
}

/**
 * The card, as the boxes on screen.
 *
 * Everything is a string, including the numbers and the ids: that is what an
 * `input` and a `select` hold, and a form that stored anything else would be
 * converting on every keystroke instead of twice.
 */
function toForm(card: CardDetailView): CardForm {
  return {
    ...toTextForm(card),
    type: card.type,
    priority: card.priority ?? '',
    points: card.points === null ? '' : String(card.points),
    estimate: card.estimateMinutes === null ? '' : formatDuration(card.estimateMinutes),
    milestoneId: card.milestone?.id ?? '',
    assigneeId: card.assignee?.userId ?? '',
    reporterId: card.reporter?.userId ?? '',
  };
}

/** The fields somebody types into, where absent and empty are the same thing. */
function toTextForm(
  card: CardDetailView,
): Pick<
  CardForm,
  'title' | 'description' | 'acceptanceCriteria' | 'dueOn' | 'discipline' | 'fixVersion'
> {
  return {
    title: card.title,
    description: card.description ?? '',
    acceptanceCriteria: card.acceptanceCriteria ?? '',
    dueOn: card.dueOn ?? '',
    discipline: card.discipline ?? '',
    fixVersion: card.fixVersion ?? '',
  };
}

/**
 * The boxes on screen, as the edit to send.
 *
 * The other direction of `toForm`, and the mirror of its one rule: an empty box
 * is `null` rather than an empty string, because a card with no assignee has
 * nobody rather than somebody called nothing.
 */
function toEdit(cardId: string, form: CardForm, estimateMinutes: number | null) {
  return {
    cardId,
    title: form.title,
    description: blankToNull(form.description),
    acceptanceCriteria: blankToNull(form.acceptanceCriteria),
    type: form.type,
    priority: form.priority === '' ? null : (form.priority as CardPriority),
    points: form.points === '' ? null : Number(form.points),
    estimateMinutes,
    dueOn: blankToNull(form.dueOn),
    discipline: blankToNull(form.discipline),
    fixVersion: blankToNull(form.fixVersion),
    milestoneId: blankToNull(form.milestoneId),
    assigneeId: blankToNull(form.assigneeId),
    reporterId: blankToNull(form.reporterId),
  };
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
}
