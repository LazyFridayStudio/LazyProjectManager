import { useId, type SelectHTMLAttributes } from 'react';

import styles from './Select.module.css';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className'> {
  readonly label: string;
  readonly options: readonly SelectOption[];
  /** A validation message from the server or the form. Shown under the control. */
  readonly problem?: string | undefined;
  /**
   * Keeps the label for a screen reader and takes it off the screen.
   *
   * For a control in a table, where the column heading is the visible label and
   * repeating it on every row would be a stutter — but where a screen reader
   * moving cell by cell has no heading in earshot.
   */
  readonly hideLabel?: boolean;
}

/**
 * A labelled dropdown, bound to its label the same way `Field` is.
 *
 * A native `select` rather than a styled listbox: it is the one control that
 * behaves correctly with a keyboard, a screen reader and a phone without any
 * help from us.
 */
export function Select({
  label,
  options,
  problem,
  hideLabel = false,
  ...selectProps
}: SelectProps): React.JSX.Element {
  const selectId = useId();
  const problemId = `${selectId}-problem`;

  return (
    <div className={styles.field}>
      <label className={hideLabel ? styles.labelForScreenReaders : styles.label} htmlFor={selectId}>
        {label}
      </label>
      <select
        {...selectProps}
        id={selectId}
        className={styles.select}
        aria-invalid={problem === undefined ? undefined : true}
        aria-describedby={problem === undefined ? undefined : problemId}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {problem !== undefined && (
        <span id={problemId} className={styles.problem} role="alert">
          {problem}
        </span>
      )}
    </div>
  );
}
