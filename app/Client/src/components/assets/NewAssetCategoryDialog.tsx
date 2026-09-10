import type { AssetCategory } from '@lpm/shared';
import { useState, type ChangeEvent } from 'react';

import { readFieldProblems } from '../../api/failure-messages.js';
import { CategoryParent } from './CategoryParent.js';
import { Button, ColorPicker, Field, useModalDialog } from '../ui/index.js';
import { toMinorUnits } from '../../logic/projects/format-project-values.js';
import { DEFAULT_PICKABLE_COLOR } from '../../tokens/pickable-colors.js';
import { useCreateAssetCategory } from '../../logic/assets/use-assets.js';
import styles from './AssetLibraryScreen.module.css';

export interface NewAssetCategoryDialogProps {
  readonly projectId: string;
  readonly projectSlug: string;
  readonly currency: string;
  /** The library as it stands, so the new one can be put inside something. */
  readonly categories: readonly AssetCategory[];
  readonly onDone: () => void;
}

/**
 * Adds a category to the library.
 *
 * A project starts with none: what a game is made of differs by game, so
 * defaults would be four categories everybody deletes before adding their own.
 */
export function NewAssetCategoryDialog({
  projectId,
  projectSlug,
  currency,
  categories,
  onDone,
}: NewAssetCategoryDialogProps): React.JSX.Element {
  const dialog = useModalDialog(onDone);
  const createCategory = useCreateAssetCategory(projectSlug);
  const problems = readFieldProblems(createCategory.error);
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [color, setColor] = useState<string>(DEFAULT_PICKABLE_COLOR);
  const [parentId, setParentId] = useState<string | null>(null);

  const submit = (): void => {
    createCategory.mutate(
      {
        projectId,
        parentId,
        name: name.trim(),
        color,
        budgetMinor: budget.trim() === '' ? null : toMinorUnits(budget),
      },
      { onSuccess: dialog.close },
    );
  };

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label="New category">
      <form
        className={styles.dialogForm}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 className={styles.dialogHeading}>New category</h2>
        <p className={styles.dialogExplanation}>
          What kind of thing this groups — environment props, world bosses, weapons. It can sit
          inside another category, as deep as a library needs to go.
        </p>

        <Field
          label="Name"
          autoFocus
          placeholder="Environment Props"
          value={name}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setName(event.target.value);
          }}
          problem={problems.name}
        />

        <CategoryParent
          categories={categories}
          value={parentId}
          problem={problems.parentId}
          onChange={setParentId}
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
            busy={createCategory.isPending}
            busyLabel="Adding…"
            disabled={name.trim() === ''}
          >
            Add category
          </Button>
        </div>
      </form>
    </dialog>
  );
}
