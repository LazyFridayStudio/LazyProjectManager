import type { BoardList } from '@lpm/shared';
import { useState, type ChangeEvent } from 'react';

import { describeFailure, readFieldProblems } from '../../api/failure-messages.js';
import { Button, ColorPicker, Field, Select, useModalDialog } from '../ui/index.js';
import styles from '../projects/NewProjectDialog.module.css';
import { useArchiveList, useCreateList, useUpdateList } from '../../logic/board/use-lists.js';
import { DEFAULT_PICKABLE_COLOR } from '../../tokens/pickable-colors.js';

export interface ListDialogProps {
  readonly boardId: string;
  readonly projectSlug: string;
  /** The list being changed, or null when one is being added. */
  readonly list: BoardList | null;
  /** Somewhere for the cards to go if this list is removed. */
  readonly otherLists: readonly BoardList[];
  readonly onClose: () => void;
}

/**
 * Adds a list, or changes one that is already there.
 *
 * One dialog for both, because they are the same three fields and a separate
 * "edit" form is how the two drift into disagreeing about what a list may be.
 */
export function ListDialog({
  boardId,
  projectSlug,
  list,
  otherLists,
  onClose,
}: ListDialogProps): React.JSX.Element {
  const dialog = useModalDialog(onClose);

  return (
    <dialog
      {...dialog.dialogProps}
      className={styles.dialog}
      aria-label={list === null ? 'New list' : 'List settings'}
    >
      <ListForm
        boardId={boardId}
        projectSlug={projectSlug}
        list={list}
        otherLists={otherLists}
        onDone={dialog.close}
      />
    </dialog>
  );
}

interface ListFormProps extends Omit<ListDialogProps, 'onClose'> {
  readonly onDone: () => void;
}

/** Only one of the three mutations can have failed, so the first is the one. */
function firstFailure(errors: readonly (Error | null)[]): Error | null {
  return errors.find((error) => error !== null) ?? null;
}

/** An empty limit field is no limit, which is not the same as a limit of zero. */
function readLimit(wipLimit: string): number | null {
  return wipLimit.trim() === '' ? null : Number(wipLimit);
}

/**
 * The state behind the list dialog.
 *
 * Three mutations sit behind one form — add, change and remove — and pulling
 * them out is what keeps the markup readable.
 */
function useListForm({ boardId, projectSlug, list, otherLists, onDone }: ListFormProps) {
  const [name, setName] = useState(list?.name ?? '');
  const [color, setColor] = useState(list?.color ?? DEFAULT_PICKABLE_COLOR);
  const [wipLimit, setWipLimit] = useState(
    list?.wipLimit === null || list?.wipLimit === undefined ? '' : String(list.wipLimit),
  );
  const [moveCardsTo, setMoveCardsTo] = useState(otherLists[0]?.id ?? '');

  const createList = useCreateList(projectSlug);
  const updateList = useUpdateList(projectSlug);
  const archiveList = useArchiveList(projectSlug);

  const update =
    (set: (value: string) => void) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => {
      set(event.target.value);
    };

  return {
    name,
    color,
    wipLimit,
    moveCardsTo,
    update: { name: update(setName), wipLimit: update(setWipLimit) },
    onColorChange: setColor,
    onMoveCardsToChange: update(setMoveCardsTo),
    isSaving: createList.isPending || updateList.isPending,
    isRemoving: archiveList.isPending,
    failure: firstFailure([createList.error, updateList.error, archiveList.error]),

    save: (): void => {
      const fields = { name, color, wipLimit: readLimit(wipLimit) };

      if (list === null) {
        createList.mutate({ boardId, ...fields }, { onSuccess: onDone });
        return;
      }

      updateList.mutate({ listId: list.id, ...fields }, { onSuccess: onDone });
    },

    remove: (): void => {
      if (list !== null) {
        archiveList.mutate(
          { listId: list.id, moveCardsToListId: moveCardsTo === '' ? null : moveCardsTo },
          { onSuccess: onDone },
        );
      }
    },
  };
}

function ListForm(props: ListFormProps): React.JSX.Element {
  const { list, otherLists, onDone } = props;
  const form = useListForm(props);
  const problems = readFieldProblems(form.failure);

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        form.save();
      }}
    >
      <h2 className={styles.heading}>{list === null ? 'New list' : list.name}</h2>
      <p className={styles.explanation}>
        {list === null
          ? 'It goes on the end of the board. Drag a column by its heading to move it.'
          : 'A limit refuses a card arriving once the list is full.'}
      </p>

      <Field
        label="Name"
        autoFocus
        placeholder="In outsourcing"
        value={form.name}
        onChange={form.update.name}
        problem={problems.name}
      />

      <ColorPicker
        label="Colour"
        value={form.color}
        onChange={form.onColorChange}
        problem={problems.color}
      />

      <Field
        label="Limit"
        type="number"
        min={1}
        step={1}
        placeholder="none"
        value={form.wipLimit}
        onChange={form.update.wipLimit}
        hint="Leave it empty for no limit."
        problem={problems.wipLimit}
      />

      {form.failure !== null && Object.keys(problems).length === 0 && (
        <p className={styles.problem} role="alert">
          {describeFailure(form.failure)}
        </p>
      )}

      {list !== null && (
        <RemoveList
          list={list}
          otherLists={otherLists}
          moveCardsTo={form.moveCardsTo}
          onMoveCardsToChange={form.onMoveCardsToChange}
          onRemove={form.remove}
          isRemoving={form.isRemoving}
        />
      )}

      <div className={styles.actions}>
        <Button tone="stop" onClick={onDone}>
          Cancel
        </Button>
        <Button tone="go" type="submit" busy={form.isSaving} busyLabel="Saving…">
          {list === null ? 'Add list' : 'Save list'}
        </Button>
      </div>
    </form>
  );
}

interface RemoveListProps {
  readonly list: BoardList;
  readonly otherLists: readonly BoardList[];
  readonly moveCardsTo: string;
  readonly onMoveCardsToChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  readonly onRemove: () => void;
  readonly isRemoving: boolean;
}

/**
 * Takes the list off the board, for good.
 *
 * Called removing rather than archiving because that is what it is: nothing
 * anywhere brings a list back, and a button that says archive is a promise of a
 * way back that the product does not keep.
 *
 * The cards have to go somewhere, so the destination is chosen here rather than
 * being discovered by the server refusing.
 */
function RemoveList({
  list,
  otherLists,
  moveCardsTo,
  onMoveCardsToChange,
  onRemove,
  isRemoving,
}: RemoveListProps): React.JSX.Element {
  const hasCards = list.count > 0;

  return (
    <>
      <h3 className={styles.heading}>Remove</h3>
      <p className={styles.explanation}>
        {hasCards
          ? `${String(list.count)} cards are on this list. They move rather than disappear, but the list itself does not come back.`
          : 'Nothing is on this list, so nothing moves. The list itself does not come back.'}
      </p>

      {hasCards && (
        <Select
          label="Move the cards to"
          options={otherLists.map((other) => ({ value: other.id, label: other.name }))}
          value={moveCardsTo}
          onChange={onMoveCardsToChange}
        />
      )}

      <div className={styles.actions}>
        {/* Words rather than the bin, and the rule says so: what keeps its words
            is the button that *is* the confirmation. Everything above — the
            count, where the cards go, that the list does not come back — is the
            confirmation, and this is the press at the end of it. */}
        <Button tone="stop" onClick={onRemove} busy={isRemoving} busyLabel="Removing…">
          Remove list
        </Button>
      </div>
    </>
  );
}
