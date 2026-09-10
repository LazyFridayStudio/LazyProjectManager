import { useId, type InputHTMLAttributes } from 'react';

import { joinClassNames } from '../../lib/join-class-names.js';
import styles from './Field.module.css';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> {
  readonly label: string;
  /** A validation message from the server or the form. Shown under the input. */
  readonly problem?: string | undefined;
  readonly hint?: string | undefined;
}

/**
 * A labelled text input.
 *
 * The label is bound to the input by a generated id rather than by wrapping,
 * because screen readers announce the association more reliably, and the
 * problem message is wired through `aria-describedby` so it is read out with
 * the field instead of being visual-only.
 */
export function Field({ label, problem, hint, ...inputProps }: FieldProps): React.JSX.Element {
  const inputId = useId();
  const problemId = `${inputId}-problem`;
  const hintId = `${inputId}-hint`;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <input
        {...inputProps}
        id={inputId}
        className={joinClassNames(styles.input, problem !== undefined && styles.invalid)}
        aria-invalid={problem === undefined ? undefined : true}
        aria-describedby={
          problem === undefined ? (hint === undefined ? undefined : hintId) : problemId
        }
      />
      {problem !== undefined && (
        <span id={problemId} className={styles.problem} role="alert">
          {problem}
        </span>
      )}
      {problem === undefined && hint !== undefined && (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      )}
    </div>
  );
}
