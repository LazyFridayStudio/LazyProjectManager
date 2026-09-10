import type { AssetCategory } from '@lpm/shared';
import { useState, type ChangeEvent } from 'react';

import { readFieldProblems } from '../../api/failure-messages.js';
import { Button, ColorPicker, Field, useModalDialog } from '../ui/index.js';
import { toMinorUnits } from '../../logic/projects/format-project-values.js';
import { useMoveAssetCategory, useUpdateAssetCategory } from '../../logic/assets/use-assets.js';
import { CategoryParent } from './CategoryParent.js';
import styles from './AssetLibraryScreen.module.css';

export interface EditCategoryDialogProps {
  readonly category: AssetCategory;
  readonly projectSlug: string;
  readonly currency: string;
  /** The whole library, so this one can be moved inside another. */
  readonly categories: readonly AssetCategory[];
  /** Where it sits now, and null when it is at the top. */
  readonly parentId: string | null;
  readonly onDone: () => void;
}

/**
 * Changes a category: what it is called, what colour it is drawn in, what it is
 * expected to cost.
 *
 * The same three fields the dialog that made it asked for, because a thing you
 * can create with three questions and only change with one is a thing people
 * delete and remake.
 */
export function EditCategoryDialog({
  category,
  projectSlug,
  currency,
  categories,
  parentId,
  onDone,
}: EditCategoryDialogProps): React.JSX.Element {
  const dialog = useModalDialog(onDone);
  const updateCategory = useUpdateAssetCategory(projectSlug);
  const moveCategory = useMoveAssetCategory(projectSlug);
  const problems = readFieldProblems(updateCategory.error);

  const [name, setName] = useState(category.name);
  const [color, setColor] = useState<string>(category.color);
  // Shown in major units, as everywhere somebody types money.
  const [budget, setBudget] = useState(
    category.budgetMinor === null ? '' : String(category.budgetMinor / 100),
  );
  const [wantedParentId, setWantedParentId] = useState<string | null>(parentId);

  const submit = (): void => {
    /*
     * Two commands, because they are two different things happening.
     *
     * Renaming a heading is an edit; taking it out of one category and putting
     * it in another is a move, and `assets.moveCategory` is what the drag sends
     * for the same act. One command doing both would put "moved" and "renamed"
     * behind one word in the audit trail.
     *
     * Only when it actually changed, so saving a colour does not write a move
     * that moves nothing.
     */
    if (wantedParentId !== parentId) {
      moveCategory.mutate({
        move: {
          categoryId: category.id,
          parentId: wantedParentId,
          // The end of wherever it lands. A dialog has no opinion about the
          // order — that is what dragging the heading is for.
          beforeCategoryId: null,
          afterCategoryId: null,
        },
        libraryBefore: null,
      });
    }

    updateCategory.mutate(
      {
        categoryId: category.id,
        name: name.trim(),
        color,
        budgetMinor: budget.trim() === '' ? null : toMinorUnits(budget),
      },
      {
        onSuccess: dialog.close,
        // A problem with a field stays on that field; anything else has
        // nowhere to be but the display.
      },
    );
  };

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label="Edit category">
      <form
        className={styles.dialogForm}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 className={styles.dialogHeading}>Edit {category.name}</h2>
        <p className={styles.dialogExplanation}>
          Renaming it does not move anything: the assets stay where they are. Moving it takes
          everything inside it along.
        </p>

        <Field
          label="Name"
          autoFocus
          value={name}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setName(event.target.value);
          }}
          problem={problems.name}
        />

        <CategoryParent
          categories={categories}
          value={wantedParentId}
          exclude={category}
          problem={problems.parentId}
          onChange={setWantedParentId}
        />

        <Field
          label={`Budget (${currency})`}
          placeholder="40000"
          hint="What this category is expected to cost, if anybody has decided yet."
          value={budget}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setBudget(event.target.value);
          }}
          problem={problems.budgetMinor}
        />

        <ColorPicker label="Colour" value={color} onChange={setColor} problem={problems.color} />

        <div className={styles.dialogActions}>
          <Button tone="stop" onClick={dialog.close}>
            Cancel
          </Button>
          <Button
            tone="go"
            type="submit"
            busy={updateCategory.isPending}
            busyLabel="Saving…"
            disabled={name.trim() === ''}
          >
            Save changes
          </Button>
        </div>
      </form>
    </dialog>
  );
}
