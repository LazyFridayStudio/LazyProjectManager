import { useState } from 'react';

import { THEME_COLOR_NAMES, type ThemeColorName, type ThemeColors } from '@lpm/shared';

import { isReadable } from '../../tokens/custom/build-theme.js';
import { lightnessOf } from '../../tokens/custom/oklab.js';
import { useUpdateProfile } from '../../logic/auth/use-account.js';
import { Button } from '../ui/index.js';
import styles from './ThemePanel.module.css';

/**
 * What a theme starts from.
 *
 * The dark theme's own colours, because a custom theme is a thing somebody
 * changes rather than a thing they build from nothing — an empty panel of eight
 * colour wells is a worse first minute than one already showing the app they
 * are looking at.
 */
export const STARTING_COLORS: ThemeColors = {
  background: '#242424',
  text: '#f2f2f2',
  accent: '#eda363',
  secondary: '#63aeeb',
  tertiary: '#63eba3',
  danger: '#eb7d73',
  warning: '#f0de8a',
  success: '#63eba3',
  scheme: 'dark',
};

const LABELS: Readonly<Record<ThemeColorName, string>> = {
  background: 'Ground',
  text: 'Text',
  accent: 'Primary',
  secondary: 'Secondary',
  tertiary: 'Tertiary',
  danger: 'Danger',
  warning: 'Warning',
  success: 'Success',
};

/**
 * The colours of a theme somebody writes for themselves.
 *
 * Eight rather than ninety. Almost every custom property the app draws with is
 * derived — the text tones are percentages of the text colour, the prose
 * headings are three steps of the accent ramp, the panel and the surface are
 * steps off the ground — so this asks for the small set at the root and
 * everything else follows.
 */
export function ThemePanel({
  colors,
  isChosen,
}: {
  readonly colors: ThemeColors | null;
  readonly isChosen: boolean;
}): React.JSX.Element {
  const save = useUpdateProfile();
  const [draft, setDraft] = useState<ThemeColors>(colors ?? STARTING_COLORS);
  const readable = isReadable(draft);

  const set = (name: ThemeColorName, value: string): void => {
    const next = { ...draft, [name]: value };

    setDraft(next);

    // The scheme follows the ground unless somebody has said otherwise, which
    // is what makes a checkbox and a scrollbar match without being asked about.
    if (name === 'background') {
      const lightness = lightnessOf(value);

      if (lightness !== null) {
        setDraft({ ...next, scheme: lightness > 0.62 ? 'light' : 'dark' });
      }
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.wells}>
        {THEME_COLOR_NAMES.map((name) => (
          <label key={name} className={styles.well}>
            <input
              type="color"
              className={styles.swatch}
              value={draft[name]}
              onChange={(event) => {
                set(name, event.target.value);
              }}
            />
            <span className={styles.wellLabel}>{LABELS[name]}</span>
          </label>
        ))}
      </div>

      <label className={styles.scheme}>
        <input
          type="checkbox"
          checked={draft.scheme === 'light'}
          onChange={(event) => {
            setDraft({ ...draft, scheme: event.target.checked ? 'light' : 'dark' });
          }}
        />
        {/* The browser cannot work this out from a hex, and it is what makes a
            checkbox, a date picker and a scrollbar match the rest. */}
        Draw the browser’s own controls for a light ground
      </label>

      {!readable && (
        <p className={styles.warning} role="alert">
          The text and the ground are too close to tell apart. Saving this would leave you a screen
          you cannot read.
        </p>
      )}

      <div className={styles.actions}>
        <Button
          tone="go"
          disabled={!readable || save.isPending}
          busy={save.isPending}
          busyLabel="Saving…"
          onClick={() => {
            save.mutate({ theme: 'custom', themeColors: draft });
          }}
        >
          {isChosen ? 'Save theme' : 'Use this theme'}
        </Button>

        {/*
          Drawn in colours nothing can change, so it is reachable from inside a
          theme that cannot be read. Everything else here takes its colours from
          the tokens, which is exactly what somebody has just broken — a reset
          that went with them would be a person locked out of their own account
          window. Inline rather than in the stylesheet because a stylesheet may
          not write a colour down, and this one has to.
        */}
        <button
          type="button"
          className={styles.reset}
          style={{ background: '#ffffff', color: '#1d1f20', border: '2px solid #1d1f20' }}
          onClick={() => {
            setDraft(STARTING_COLORS);
            save.mutate({ theme: 'dark', themeColors: null });
          }}
        >
          Reset to Dark
        </button>
      </div>
    </div>
  );
}
