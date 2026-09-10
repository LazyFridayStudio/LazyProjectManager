import type { ThemeColors } from '@lpm/shared';

import { renderPaperRule } from '../render-css-custom-properties.js';
import { buildThemeProperties } from './build-theme.js';

/** Where the rule lives, so it is replaced rather than stacked up. */
export const CUSTOM_THEME_STYLE_ID = 'lpm-custom-theme';

/** What the first-paint script reads, so a custom theme does not flash. */
export const CACHED_THEME_CSS = 'lpm.theme.css';

/**
 * The stylesheet a person's own theme is written into.
 *
 * `[data-theme='custom']` rather than `:root`, so it is the same kind of thing
 * the two shipped themes are — an attribute anything can carry, which is what
 * lets the account window draw a swatch of one inside an app in another.
 *
 * Paper is re-asserted after it. Every selector in the token stylesheet is one
 * attribute or one class, so they all weigh the same and order alone decides;
 * this arrives in a later stylesheet, and without putting paper back it would
 * win over the palette a design document and anything printed depend on.
 */
export function renderCustomThemeCss(colors: ThemeColors): string {
  const properties = buildThemeProperties(colors);

  if (properties.length === 0) {
    return '';
  }

  const body = properties.map(([name, value]) => `  ${name}: ${value};`).join('\n');

  return `[data-theme='custom'] {\n${body}\n}\n\n${renderPaperRule()}`;
}

/**
 * Puts a person's theme on the page, or takes it off.
 *
 * Null is somebody on one of the two that shipped, and the rule goes with them
 * — leaving a stale palette behind would mean switching to Dark and getting
 * yesterday's custom colours under a dark attribute.
 *
 * The rendered text is cached for the script in `index.html`, which runs before
 * the bundle and is what stops a custom theme flashing its base theme on every
 * load. One word fitted there when a theme was one word; a palette does not, so
 * what is cached is the stylesheet rather than the colours.
 */
export function applyCustomTheme(colors: ThemeColors | null): void {
  const existing = document.getElementById(CUSTOM_THEME_STYLE_ID);

  if (colors === null) {
    existing?.remove();
    forget();
    return;
  }

  const css = renderCustomThemeCss(colors);
  const style = existing ?? document.createElement('style');

  style.id = CUSTOM_THEME_STYLE_ID;
  style.textContent = css;

  if (existing === null) {
    document.head.append(style);
  }

  remember(css);
}

function remember(css: string): void {
  try {
    window.localStorage.setItem(CACHED_THEME_CSS, css);
  } catch {
    // Storage is unavailable. The theme still draws; it flashes on the next
    // load, which is worth strictly nothing to report to anybody.
  }
}

function forget(): void {
  try {
    window.localStorage.removeItem(CACHED_THEME_CSS);
  } catch {
    // As above.
  }
}
