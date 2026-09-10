import { MAXIMUM_PROJECT_CODE_LENGTH, suggestProjectCode } from '@lpm/shared';
import { useState, type ChangeEvent } from 'react';

import { readFieldProblems } from '../../api/failure-messages.js';
import { Button, Field, useModalDialog } from '../ui/index.js';
import { toMinorUnits } from '../../logic/projects/format-project-values.js';
import styles from './NewProjectDialog.module.css';
import { useCreateProject } from '../../logic/projects/use-projects.js';

interface NewProjectForm {
  name: string;
  code: string;
  engine: string;
  budget: string;
  startsOn: string;
  shipsOn: string;
}

const EMPTY_FORM: NewProjectForm = {
  name: '',
  code: '',
  engine: '',
  budget: '',
  startsOn: '',
  shipsOn: '',
};

/**
 * The create-project form.
 *
 * A native `dialog` rather than a hand-built overlay: it traps focus, closes on
 * Escape and hides the page behind it from assistive technology, none of which a
 * positioned `div` gets without a pile of code that is usually wrong.
 */
export function NewProjectDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const dialog = useModalDialog(onClose);

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label="New project">
      <NewProjectFields onDone={dialog.close} />
    </dialog>
  );
}

type FieldChangeHandler = (event: ChangeEvent<HTMLInputElement>) => void;

interface NewProjectFormState {
  readonly form: NewProjectForm;
  readonly problems: Readonly<Record<string, string>>;
  readonly isPending: boolean;
  readonly error: Error | null;
  update: (field: keyof NewProjectForm) => FieldChangeHandler;
  updateName: FieldChangeHandler;
  updateCode: FieldChangeHandler;
  submit: () => void;
}

/**
 * The state behind the create form, kept apart from the markup that renders it.
 *
 * The code field is the reason this is more than `useState`: it follows the name
 * until somebody types in it, and then stops.
 */
function useNewProjectForm(onDone: () => void): NewProjectFormState {
  const [form, setForm] = useState<NewProjectForm>(EMPTY_FORM);
  const [isCodeEdited, setIsCodeEdited] = useState(false);
  const createProject = useCreateProject();

  return {
    form,
    problems: readFieldProblems(createProject.error),
    isPending: createProject.isPending,
    error: createProject.isError ? createProject.error : null,

    update:
      (field: keyof NewProjectForm) =>
      (event: ChangeEvent<HTMLInputElement>): void => {
        const { value } = event.target;
        setForm((current) => ({ ...current, [field]: value }));
      },

    updateName: (event: ChangeEvent<HTMLInputElement>): void => {
      const name = event.target.value;

      setForm((current) => ({
        ...current,
        name,
        code: isCodeEdited ? current.code : suggestProjectCode(name),
      }));
    },

    updateCode: (event: ChangeEvent<HTMLInputElement>): void => {
      setIsCodeEdited(true);
      setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }));
    },

    submit: (): void => {
      createProject.mutate(
        {
          name: form.name,
          code: form.code,
          engine: blankToNull(form.engine),
          budgetMinor: toMinorUnits(form.budget),
          startsOn: blankToNull(form.startsOn),
          shipsOn: blankToNull(form.shipsOn),
        },
        { onSuccess: onDone },
      );
    },
  };
}

function NewProjectFields({ onDone }: { onDone: () => void }): React.JSX.Element {
  const { form, problems, isPending, update, updateName, updateCode, submit } =
    useNewProjectForm(onDone);

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h2 className={styles.heading}>New project</h2>
      <p className={styles.explanation}>
        The code is the root of every ticket key this project issues, and cannot be changed
        afterwards.
      </p>

      <Field
        label="Project name"
        autoFocus
        placeholder="Example Project"
        value={form.name}
        onChange={updateName}
        problem={problems.name}
      />

      <div className={styles.pair}>
        <Field
          label="Code"
          placeholder="EXMP"
          maxLength={MAXIMUM_PROJECT_CODE_LENGTH}
          value={form.code}
          onChange={updateCode}
          hint={`${form.code === '' ? 'EXMP' : form.code}-ART-1`}
          problem={problems.code}
        />
        <Field
          label="Engine"
          placeholder="Unreal 5.5"
          value={form.engine}
          onChange={update('engine')}
          problem={problems.engine}
        />
      </div>

      <Field
        label="Budget"
        type="number"
        min={0}
        step={1}
        placeholder="640000"
        value={form.budget}
        onChange={update('budget')}
        hint="Whole dollars. Leave it empty if there is no budget yet."
        problem={problems.budgetMinor}
      />

      <div className={styles.pair}>
        <Field
          label="Production start"
          type="date"
          value={form.startsOn}
          onChange={update('startsOn')}
          problem={problems.startsOn}
        />
        <Field
          label="Target ship"
          type="date"
          value={form.shipsOn}
          onChange={update('shipsOn')}
          problem={problems.shipsOn}
        />
      </div>

      <div className={styles.actions}>
        <Button tone="stop" onClick={onDone}>
          Cancel
        </Button>
        <Button tone="go" type="submit" busy={isPending} busyLabel="Creating…">
          Create project
        </Button>
      </div>
    </form>
  );
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
}
