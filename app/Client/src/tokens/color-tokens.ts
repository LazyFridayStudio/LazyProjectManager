/**
 * Colour tokens, taken verbatim from the design prototype's `:root` block.
 *
 * These constants and the CSS custom properties the app loads are rendered from
 * the same source (see `renderCssCustomProperties`), so a value can never be
 * changed in one place and forgotten in the other.
 */

/**
 * A nine-step tonal ramp: 100 recedes into the ground, 900 stands off it.
 *
 * On a dark ground that means 100 is the darkest and 900 the lightest, which is
 * how these were first written. The step is the *distance from the ground*
 * rather than an absolute lightness, and the light theme's ramps run the other
 * way for the same reason — `--color-accent-700` is an accented word in both,
 * and a word has to be readable on whatever it is sitting on.
 */
export interface TonalRamp {
  readonly 100: string;
  readonly 200: string;
  readonly 300: string;
  readonly 400: string;
  readonly 500: string;
  readonly 600: string;
  readonly 700: string;
  readonly 800: string;
  readonly 900: string;
}

export const accentRamp: TonalRamp = {
  100: '#3a2a18',
  200: '#4a3520',
  300: '#5e442a',
  400: '#86603a',
  500: '#c08a55',
  600: '#eda363',
  700: '#f2b782',
  800: '#f7cda6',
  900: '#fbe3cc',
};

export const secondaryRamp: TonalRamp = {
  100: '#172533',
  200: '#1d3247',
  300: '#26425e',
  400: '#365d86',
  500: '#4d8bc7',
  600: '#63aeeb',
  700: '#8bc3f1',
  800: '#b0d6f6',
  900: '#d3e9fb',
};

export const tertiaryRamp: TonalRamp = {
  100: '#16301f',
  200: '#1b402a',
  300: '#235436',
  400: '#31764c',
  500: '#48b075',
  600: '#63eba3',
  700: '#8bf0bb',
  800: '#b0f5d0',
  900: '#d3fae5',
};

export const neutralRamp: TonalRamp = {
  100: '#333333',
  200: '#3a3a3a',
  300: '#484848',
  400: '#555555',
  500: '#6a6a6a',
  600: '#8c8c8c',
  700: '#adadad',
  800: '#d0d0d0',
  900: '#f2f2f2',
};

/**
 * The accent, for a light ground.
 *
 * Not the dark ramp reversed. Reversing it gives `#5e442a` where an accented
 * word wants to be, which is a muddy brown rather than the product's orange —
 * the dark ramp's low steps were chosen to sit *on* something dark, not to be
 * read against white. These are chosen for a light ground, and 600 and 700 are
 * the paper theme's accent and its strong pair, which had already answered this
 * question for document surfaces.
 */
export const lightAccentRamp: TonalRamp = {
  100: '#fdf2e6',
  200: '#fae1c8',
  300: '#f3c99e',
  400: '#e19d61',
  500: '#c97a26',
  600: '#b3611c',
  700: '#8a4a12',
  800: '#6b390d',
  900: '#4a2708',
};

/**
 * The greys, for a light ground.
 *
 * The dark ramp turned around, which for a neutral scale is exactly right:
 * there is nothing to a grey but its distance from the ground, and every step
 * here is the mirror of the one that recedes or stands out by the same amount
 * on dark.
 */
export const lightNeutralRamp: TonalRamp = {
  100: '#f2f2f2',
  200: '#d0d0d0',
  300: '#adadad',
  400: '#8c8c8c',
  500: '#6a6a6a',
  600: '#555555',
  700: '#484848',
  800: '#3a3a3a',
  900: '#333333',
};

/**
 * The dark theme is the application chrome — every screen except document
 * surfaces, which switch to `paperThemeColors` via the `.lpm-paper` class.
 */
/**
 * Three grounds, in the order things stack.
 *
 * The app sits on `background`; the panels that divide it — the board area, a
 * dialog — sit on `panel`; and the things you pick up, cards and tiles, sit on
 * `surface`. Each step is lighter than the one under it, so depth is read from
 * the tone rather than from a shadow, and a plate that is on the wrong one is
 * visible immediately.
 */
export const darkThemeColors = {
  background: '#242424',
  panel: neutralRamp[100],
  surface: neutralRamp[200],
  /**
   * The ground under a screen's title bar.
   *
   * Darker than a panel and lighter than the app behind it, which is what makes
   * the bar read as the chrome at the top of a page rather than as the first
   * panel of the screen. It needs a ground of its own at all because the app's
   * is a drifting canvas, and a header you can watch move is a header that
   * looks like it forgot its background.
   */
  pageTitleHeaderBackground: '#2b2b2b',
  /**
   * What you can type in.
   *
   * A ground of its own rather than a step of the neutral ramp: a text field
   * has to read as a hole in the panel it sits on, and which grey does that
   * depends on the theme rather than on the ramp. The light theme fills it
   * white while its panels stay grey, which is the same idea upside down.
   */
  control: '#3d3d3d',
  controlBorder: '#595959',
  controlBorderHover: '#5c5c5c',
  text: '#f2f2f2',
  /**
   * Text on a ground that is not the theme's.
   *
   * A label on the accent, or on the scrim over a dimmed screen. Neither
   * follows `text`: the accent is a light orange here and a dark one on paper,
   * so the word on top has to go the other way each time, and the scrim is
   * black in both themes.
   */
  textOnAccent: '#242424',
  textOnScrim: '#f2f2f2',
  /**
   * The uppercase micro-labels above a control.
   *
   * Subordinate to body text but still read at a glance. Any dimmer and the word
   * naming a field disappears into the panel behind it, which is exactly what a
   * label is for.
   */
  label: '#b8b8b8',
  divider: '#4e4e4e',
  /**
   * The headings of long-form prose: a design document, a card's description.
   *
   * Their own colours because everything else about a heading had stopped
   * separating it from the text under it. A `##` was the same white as the
   * paragraph below at four pixels' difference, and a `###` was
   * `--color-text-strong` — *dimmer* than the prose it introduced.
   *
   * Warm, because the body text is not. Hue is what says "this is a heading"
   * while somebody is scanning rather than reading; the size and the rules say
   * which level it is. Three steps of one ramp rather than three hues: a second
   * colour in a document reads as a second kind of thing.
   *
   * Not used by the app's own headings. A screen title is chrome and is already
   * told apart by where it sits.
   */
  proseHeading1: accentRamp[800],
  proseHeading2: accentRamp[700],
  proseHeading3: accentRamp[600],
  accent: accentRamp[600],
  secondary: secondaryRamp[600],
  tertiary: tertiaryRamp[600],
  danger: '#eb7d73',
  dangerStrong: '#d2564c',
  dangerMuted: '#3d211e',
  warning: '#f0de8a',
  warningStrong: '#d6c163',
  warningMuted: '#3b351c',
  success: '#63eba3',
  successStrong: '#48b075',
} as const;

/**
 * The light theme: the same chrome, on a light ground.
 *
 * A palette rather than the dark one inverted. Inverting a theme gives you the
 * right lightnesses and the wrong colours — a red that reads as danger on
 * `#242424` is a pink on white, and the whole point of the danger tone is that
 * nobody has to think about it.
 *
 * The three grounds keep their rule: each step forward is further from the
 * ground it sits on, so depth is still read from the tone. Here that means
 * lighter as it comes forward, ending at a control that is white — a field has
 * to read as a hole in the panel, which on dark means darker and here means
 * brighter. It is the same idea upside down, as the dark theme's `control` says.
 *
 * `textOnScrim` does not follow `text`, and neither does `textOnAccent`. The
 * scrim is black under both themes, so the word on it is light under both; the
 * accent goes from a light orange to a dark one, so the word on *it* goes the
 * other way.
 */
export const lightThemeColors = {
  background: '#e4e5e7',
  panel: '#eeeff1',
  surface: '#f7f8f9',
  pageTitleHeaderBackground: '#e9eaec',
  control: '#ffffff',
  controlBorder: 'color-mix(in srgb, #1d1f20 26%, transparent)',
  controlBorderHover: 'color-mix(in srgb, #1d1f20 42%, transparent)',
  text: '#1d1f20',
  textOnAccent: '#ffffff',
  textOnScrim: '#f2f2f2',
  label: '#55595b',
  divider: 'color-mix(in srgb, #1d1f20 16%, transparent)',
  /* The same three steps of the light ramp, which is built so a step means the
     same distance from the ground on either theme rather than the same colour. */
  proseHeading1: lightAccentRamp[800],
  proseHeading2: lightAccentRamp[700],
  proseHeading3: lightAccentRamp[600],
  accent: lightAccentRamp[600],
  secondary: secondaryRamp[400],
  tertiary: tertiaryRamp[400],
  danger: '#b3352a',
  dangerStrong: '#8f2a21',
  dangerMuted: '#f7ddd9',
  warning: '#8a6410',
  warningStrong: '#6b4d09',
  warningMuted: '#f7ecc7',
  success: '#1f7a4d',
  successStrong: '#175c3a',
} as const;

/**
 * What a panel is lifted with, and how hard the room is lit.
 *
 * Both are written for a dark room: a white hairline along the top edge of a
 * panel, and shadows dark enough to read against `#242424`. On a light ground
 * the highlight is invisible and the shadows are a bruise, so the light theme
 * says its own.
 */
export const lightElevation = {
  panelInsetHighlight: 'inset 0 1px 0 rgba(255,255,255,.8)',
  shadows: {
    small: '0 1px 2px rgba(29,31,32,.10)',
    medium: '0 3px 10px rgba(29,31,32,.12)',
    large: '0 12px 32px rgba(29,31,32,.18)',
  },
} as const;

/**
 * Document surfaces — the design-document editor and anything printed — invert
 * to a light ground so long-form reading and export both behave.
 */
export const paperThemeColors = {
  background: '#ffffff',
  panel: '#f4f4f5',
  surface: '#e9e9ea',
  pageTitleHeaderBackground: '#ebebec',
  control: '#ffffff',
  controlBorder: 'color-mix(in srgb, #1d1f20 26%, transparent)',
  controlBorderHover: 'color-mix(in srgb, #1d1f20 42%, transparent)',
  text: '#1d1f20',
  textOnAccent: '#ffffff',
  label: '#55595b',
  divider: 'color-mix(in srgb, #1d1f20 16%, transparent)',
  proseHeading1: lightAccentRamp[800],
  proseHeading2: lightAccentRamp[700],
  proseHeading3: lightAccentRamp[600],
  accent: '#b3611c',
  accentStrong: '#8a4a12',
} as const;

/**
 * How far a piece of text is stepped back from the one you are meant to read.
 *
 * Every stylesheet used to write its own — `color-mix(in srgb, var(--color-text)
 * 45%, transparent)` sixty times over, and fifteen other percentages besides:
 * 42 here, 48 there, 62 on one screen and 60 on the next. Nobody chose those
 * differences; they came from whichever screen was copied.
 *
 * Four steps, and a hairline. A percentage of the text colour rather than a
 * grey of its own, so a theme that changes the text changes all of them —
 * which is the whole reason this exists before there is a light one.
 */
export const textTonePercentages = {
  /** A heading's second line, a value beside its label. Nearly full strength. */
  strong: 70,
  /** Secondary prose: a hint under a field, a sentence explaining a screen. */
  muted: 60,
  /** Meta: counts, timestamps, the monospace facts under a title. */
  faint: 45,
  /** Something switched off, or a placeholder nobody has filled in. */
  dim: 32,
} as const;

/**
 * The line between rows of a table.
 *
 * Lighter than `--color-divider`, which separates one region of a screen from
 * another. This separates one row from the next, where a full divider would
 * draw a grid.
 */
export const hairlinePercentage = 7;

/**
 * What a dialog dims the screen behind it with.
 *
 * Black rather than a tone of the ground: a scrim is meant to read as the room
 * going dark, and mixing the ground into it makes the app look like it faded
 * rather than that something came forward. It was written as a raw
 * `#000000` in eight stylesheets, at 62 per cent in seven of them and 55 in the
 * eighth, which is the kind of difference nobody chose.
 */
export const scrimColor = 'color-mix(in srgb, #000000 62%, transparent)';
