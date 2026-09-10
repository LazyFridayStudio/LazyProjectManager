import { useId } from 'react';

import {
  PICKABLE_COLORS,
  isAPickableColor,
  nameOfPickableColor,
} from '../../tokens/pickable-colors.js';
import styles from './ColorPicker.module.css';

interface ColorPickerProps {
  readonly label: string;
  /** Lower-case six-digit hex, as the commands store it. */
  readonly value: string;
  readonly onChange: (color: string) => void;
  /** A validation message from the server or the form. Shown under the swatches. */
  readonly problem?: string | undefined;
}

/**
 * The colour something is drawn in: sixteen on offer, and any other one.
 *
 * A dropdown of six named colours was on the board and a row of six swatches in
 * the library, and neither could say a colour the other had — so a studio with
 * eleven kinds of thing had five of them sharing a colour with something else.
 * The offered ones are still the path: they are drawn at one tone, so a board
 * of them reads as one board rather than as whatever sixteen people picked. The
 * mixed one is a step off it, and it is the browser's own picker rather than
 * ours, which is where a colour wheel belongs.
 *
 * The hex is written out beside the label. It is what the studio's own notes
 * call the colour, it is what somebody pastes in from a brand sheet, and it is
 * the only way to tell two mixed colours apart.
 */
export function ColorPicker({
  label,
  value,
  onChange,
  problem,
}: ColorPickerProps): React.JSX.Element {
  const labelId = useId();
  const problemId = `${labelId}-problem`;
  const isMixed = !isAPickableColor(value);

  return (
    <div className={styles.field}>
      <div className={styles.head}>
        <span className={styles.label} id={labelId}>
          {label}
        </span>
        <span className={styles.chosen}>{nameOfPickableColor(value)}</span>
      </div>

      <div
        className={styles.choices}
        role="group"
        aria-labelledby={labelId}
        aria-describedby={problem === undefined ? undefined : problemId}
      >
        {PICKABLE_COLORS.map((color) => (
          <button
            key={color.value}
            type="button"
            className={styles.choice}
            style={{ background: color.value }}
            aria-label={color.name}
            aria-pressed={value.toLowerCase() === color.value}
            onClick={() => {
              onChange(color.value);
            }}
          />
        ))}

        {/*
          The browser's own picker, worn as a seventeenth swatch.

          A `label` wrapping the input rather than a button beside it: the
          input is the control, so the whole swatch opens the picker and the
          keyboard reaches it the way it reaches every other one. Until a
          colour is mixed it shows the offered ones as a wheel — what it opens
          drawn on the thing that opens it — and after that it shows the colour
          somebody chose, because a control that never shows its own value is a
          control nobody trusts they have pressed.
        */}
        <label
          className={styles.mixed}
          data-chosen={isMixed ? 'true' : undefined}
          style={{ background: isMixed ? value : wheelOfOfferedColors() }}
        >
          <span className={styles.mixedLabel}>Mix a colour</span>
          <input
            type="color"
            className={styles.mixedInput}
            value={value}
            onChange={(event) => {
              onChange(event.target.value.toLowerCase());
            }}
          />
        </label>
      </div>

      {problem !== undefined && (
        <span id={problemId} className={styles.problem} role="alert">
          {problem}
        </span>
      )}
    </div>
  );
}

/**
 * The offered colours as a wheel, for the swatch that opens the mixer.
 *
 * Built here rather than written into the stylesheet because it is made of the
 * palette: a colour added to `PICKABLE_COLORS` appears in the wheel, and no
 * stylesheet has to write a colour down to draw one.
 */
function wheelOfOfferedColors(): string {
  const stops = PICKABLE_COLORS.map((color, index) => {
    const turn = (index / PICKABLE_COLORS.length) * 360;

    return `${color.value} ${String(Math.round(turn))}deg`;
  });

  // Back to the first colour, so the wheel closes rather than showing a seam.
  return `conic-gradient(${[...stops, `${PICKABLE_COLORS[0]?.value ?? ''} 360deg`].join(', ')})`;
}
