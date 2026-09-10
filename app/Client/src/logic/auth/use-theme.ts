import { themeSchema, type Theme, type ThemeColors } from '@lpm/shared';
import { useEffect } from 'react';

import { applyCustomTheme } from '../../tokens/custom/apply-custom-theme.js';

/** Where the last answer is kept, for the inline script in `index.html`. */
const STORAGE_KEY = 'lpm.theme';

/**
 * Puts the person's theme on the document, and remembers it for next time.
 *
 * The theme lives on the server because it is a fact about them rather than
 * about the machine they happen to be sitting at. That means it arrives with
 * `identity.me`, which is well after the first paint — so the last answer is
 * cached here and read by an inline script before the bundle loads, and this
 * reconciles the two when the real one turns up.
 *
 * The cache is only ever a guess at what the server will say. When they
 * disagree the server wins, which is what makes signing in on a second machine
 * put your own theme on it rather than that machine's.
 */
export function useTheme(theme: Theme | undefined, colors: ThemeColors | null = null): void {
  useEffect(() => {
    if (theme === undefined) {
      return;
    }

    /*
     * The palette before the attribute, so there is never a frame where the
     * document says `custom` and nothing has declared what that means — which
     * is a screen with no colours rather than one in the wrong colours.
     *
     * A person on `custom` with nothing written yet falls back to dark for the
     * same reason: a half-finished row must not be a screen nobody can use to
     * finish it.
     */
    const custom = theme === 'custom' ? colors : null;

    applyCustomTheme(custom);

    const drawn: Theme = theme === 'custom' && custom === null ? 'dark' : theme;

    document.documentElement.dataset.theme = drawn;
    rememberTheme(drawn);
  }, [theme, colors]);
}

/** What the inline script read, for anything that needs it before `me` lands. */
export function rememberedTheme(): Theme {
  try {
    return themeSchema.catch('dark').parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    // Storage is unavailable in private-browsing modes and some embedded views.
    return 'dark';
  }
}

function rememberTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Forgetting the choice is a worse first second next time, not a failure.
  }
}
