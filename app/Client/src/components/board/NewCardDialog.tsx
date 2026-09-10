import { CARD_TYPES, describeCardType, type CardType } from '@lpm/shared';
import { useState, type ChangeEvent } from 'react';

import { readFieldProblems } from '../../api/failure-messages.js';
import { Button, Field, Select, useModalDialog } from '../ui/index.js';
import styles from '../projects/NewProjectDialog.module.css';
import { useCreateCard } from '../../logic/board/use-cards.js';

const TYPE_OPTIONS = CARD_TYPES.map((cardType) => ({
  value: cardType,
  label: describeCardType(cardType),
}));

interface NewCardForm {
  title: string;
  type: CardType;
  points: string;
  dueOn: string;
  description: string;
}

const EMPTY_FORM: NewCardForm = { title: '', type: 'task', points: '', dueOn: '', description: '' };

export interface NewCardDialogProps {
  readonly projectId: string;
  readonly projectSlug: string;
  /** Only the two things a new card needs: where it goes, and what to call it. */
  readonly list: { readonly id: string; readonly name: string };
  readonly onClose: () => void;
}

/**
 * Adds a card to a list.
 *
 * Deliberately short: a title and a type is enough to get something onto the
 * board, and everything else is easier to fill in on the card itself than in a
 * form standing between somebody and writing the thing down.
 */
export function NewCardDialog({
  projectId,
  projectSlug,
  list,
  onClose,
}: NewCardDialogProps): React.JSX.Element {
  const dialog = useModalDialog(onClose);
  const [form, setForm] = useState<NewCardForm>(EMPTY_FORM);
  const createCard = useCreateCard(projectSlug);
  const problems = readFieldProblems(createCard.error);

  const update =
    (field: keyof NewCardForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>): void => {
      const { value } = event.target;
      setForm((current) => ({ ...current, [field]: value }));
    };

  const submit = (): void => {
    createCard.mutate(
      {
        projectId,
        listId: list.id,
        title: form.title,
        type: form.type,
        points: form.points === '' ? null : Number(form.points),
        dueOn: form.dueOn === '' ? null : form.dueOn,
        description: form.description.trim() === '' ? null : form.description,
      },
      { onSuccess: dialog.close },
    );
  };

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label="New card">
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 className={styles.heading}>New card</h2>
        <p className={styles.explanation}>
          It goes to the end of {list.name}, and takes the next key for its type.
        </p>

        <Field
          label="Title"
          autoFocus
          placeholder="What needs doing"
          value={form.title}
          onChange={update('title')}
          problem={problems.title}
        />

        <div className={styles.pair}>
          <Select
            label="Type"
            options={TYPE_OPTIONS}
            value={form.type}
            onChange={update('type')}
            problem={problems.type}
          />
          <Field
            label="Points"
            type="number"
            min={0}
            step={1}
            placeholder="5"
            value={form.points}
            onChange={update('points')}
            problem={problems.points}
          />
        </div>

        <Field
          label="Due"
          type="date"
          value={form.dueOn}
          onChange={update('dueOn')}
          problem={problems.dueOn}
        />

        <div className={styles.actions}>
          <Button tone="stop" onClick={dialog.close}>
            Cancel
          </Button>
          <Button tone="go" type="submit" busy={createCard.isPending} busyLabel="Adding…">
            Add card
          </Button>
        </div>
      </form>
    </dialog>
  );
}
