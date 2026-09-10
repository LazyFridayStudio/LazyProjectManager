import {
  accentRamp,
  darkThemeColors,
  lightAccentRamp,
  lightElevation,
  lightNeutralRamp,
  lightThemeColors,
  hairlinePercentage,
  scrimColor,
  textTonePercentages,
  neutralRamp,
  paperThemeColors,
  secondaryRamp,
  tertiaryRamp,
  type TonalRamp,
} from './color-tokens.js';
import { colorByAssetStatus, assetStatuses } from './asset-status-colors.js';
import { colorByCardType, cardTypes } from './card-type-colors.js';
import {
  baseLineHeight,
  fontFamilies,
  fontSizesPx,
  headingFontWeight,
  headingLineHeight,
  titleFontWeight,
} from './typography-tokens.js';
import { borderRadiusPx, elevationShadows, panelInsetHighlight } from './shape-tokens.js';
import {
  categoryInkPercent,
  disabledOpacity,
  focusRingOffsetPx,
  listTintOverPercent,
  listTintPercent,
  focusRingOutline,
  navigationHoverBackground,
  rowHoverBackground,
  tileHoverBackground,
} from './interaction-state-tokens.js';

type CustomPropertyDeclaration = readonly [name: string, value: string];

/**
 * Renders every token in this package as a CSS stylesheet.
 *
 * The web app loads the output of this function instead of a hand-written
 * stylesheet, which is what stops the TypeScript constants and the CSS custom
 * properties from drifting apart. Served to the app as `virtual:lpm-tokens.css` by the Vite plugin in
 * vite.config.ts, so there is no generated file to keep in step.
 */
export function renderCssCustomProperties(): string {
  return [
    renderRule(':root', [
      ...renderRampDeclarations('accent', accentRamp),
      ...renderRampDeclarations('secondary', secondaryRamp),
      ...renderRampDeclarations('tertiary', tertiaryRamp),
      ...renderRampDeclarations('neutral', neutralRamp),
      ...darkThemeDeclarations(),
      ...textToneDeclarations(),
      ...cardTypeDeclarations(),
      ...assetStatusDeclarations(),
      ...typographyDeclarations(),
      ...shapeDeclarations(),
      ...interactionStateDeclarations(),
    ]),
    /*
     * A theme is something an element carries, not only the document.
     *
     * `:root` above holds the dark values as the default, and these two
     * repeat them under an attribute so a `data-theme` anywhere works — which
     * is what lets the account window draw a light swatch inside a dark app
     * by putting the theme on the swatch, rather than by writing the palette
     * out a second time in a stylesheet.
     *
     * Every selector here is one attribute or one pseudo-class, so they all
     * weigh the same and order alone decides. `.lpm-paper` is last for that
     * reason: a document surface keeps its own palette whichever theme the
     * chrome is in.
     */
    renderRule("[data-theme='dark']", darkThemeDeclarations()),
    renderRule("[data-theme='light']", lightThemeDeclarations()),
    renderRule('.lpm-paper', paperThemeDeclarations()),
  ].join('\n\n');
}

/**
 * The paper rule, on its own, for the runtime layer to put back after itself.
 *
 * A custom theme arrives in a stylesheet of its own, which loads after this one
 * — so with everything weighing the same, it would beat `.lpm-paper` on order
 * alone. Re-asserting paper behind it keeps the rule this file already states:
 * a document surface keeps its own palette whichever theme the chrome is in,
 * which is what makes long-form reading and print behave.
 */
export function renderPaperRule(): string {
  return renderRule('.lpm-paper', paperThemeDeclarations());
}

function renderRule(selector: string, declarations: readonly CustomPropertyDeclaration[]): string {
  const body = declarations.map(([name, value]) => `  ${name}: ${value};`).join('\n');
  return `${selector} {\n${body}\n}`;
}

function renderRampDeclarations(
  rampName: string,
  ramp: TonalRamp,
): readonly CustomPropertyDeclaration[] {
  return Object.entries(ramp).map(([step, color]) => [`--color-${rampName}-${step}`, color]);
}

function darkThemeDeclarations(): readonly CustomPropertyDeclaration[] {
  return [
    ['--color-bg', darkThemeColors.background],
    ['--color-panel', darkThemeColors.panel],
    ['--color-surface', darkThemeColors.surface],
    ['--color-text', darkThemeColors.text],
    ['--color-page-title-header-background', darkThemeColors.pageTitleHeaderBackground],
    ['--color-control', darkThemeColors.control],
    ['--color-control-border', darkThemeColors.controlBorder],
    ['--color-control-border-hover', darkThemeColors.controlBorderHover],
    ['--color-text-on-accent', darkThemeColors.textOnAccent],
    // The scrim is black under either theme, so what reads on it is too.
    ['--color-text-on-scrim', darkThemeColors.textOnScrim],
    ['--color-label', darkThemeColors.label],
    ['--color-divider', darkThemeColors.divider],
    ['--color-prose-heading-1', darkThemeColors.proseHeading1],
    ['--color-prose-heading-2', darkThemeColors.proseHeading2],
    ['--color-prose-heading-3', darkThemeColors.proseHeading3],
    ['--color-accent', darkThemeColors.accent],
    ['--color-secondary', darkThemeColors.secondary],
    ['--color-tertiary', darkThemeColors.tertiary],
    ['--color-danger', darkThemeColors.danger],
    ['--color-danger-500', darkThemeColors.dangerStrong],
    ['--color-danger-200', darkThemeColors.dangerMuted],
    ['--color-warn', darkThemeColors.warning],
    ['--color-warn-500', darkThemeColors.warningStrong],
    ['--color-warn-200', darkThemeColors.warningMuted],
    ['--color-ok', darkThemeColors.success],
    ['--color-ok-500', darkThemeColors.successStrong],
    // Said here rather than in `global.css`: that file loads after this one, so
    // a `color-scheme` on `:root` there beat whatever the chosen theme asked
    // for and a light app kept a dark scrollbar.
    ['--list-tint', `${String(listTintPercent.dark)}%`],
    ['--category-ink', `${String(categoryInkPercent.dark)}%`],
    ['--list-tint-over', `${String(listTintOverPercent.dark)}%`],
    ['color-scheme', 'dark'],
  ];
}

/**
 * Everything the light theme says differently.
 *
 * The ramps as well as the palette: a stylesheet asking for `--color-accent-700`
 * wants an accented word, and on a light ground that is a dark orange rather
 * than the pale one that reads on `#242424`. The stepped-back text tones are
 * not here, because they are percentages of `--color-text` and follow it for
 * free — which is the whole reason they were written that way before there was
 * a light theme to prove it.
 */
function lightThemeDeclarations(): readonly CustomPropertyDeclaration[] {
  return [
    ...renderRampDeclarations('accent', lightAccentRamp),
    ...renderRampDeclarations('neutral', lightNeutralRamp),
    ['--color-bg', lightThemeColors.background],
    ['--color-panel', lightThemeColors.panel],
    ['--color-surface', lightThemeColors.surface],
    ['--color-text', lightThemeColors.text],
    ['--color-page-title-header-background', lightThemeColors.pageTitleHeaderBackground],
    ['--color-control', lightThemeColors.control],
    ['--color-control-border', lightThemeColors.controlBorder],
    ['--color-control-border-hover', lightThemeColors.controlBorderHover],
    ['--color-text-on-accent', lightThemeColors.textOnAccent],
    // Still light: the scrim is black under either theme.
    ['--color-text-on-scrim', lightThemeColors.textOnScrim],
    ['--color-label', lightThemeColors.label],
    ['--color-divider', lightThemeColors.divider],
    ['--color-prose-heading-1', lightThemeColors.proseHeading1],
    ['--color-prose-heading-2', lightThemeColors.proseHeading2],
    ['--color-prose-heading-3', lightThemeColors.proseHeading3],
    ['--color-accent', lightThemeColors.accent],
    ['--color-secondary', lightThemeColors.secondary],
    ['--color-tertiary', lightThemeColors.tertiary],
    ['--color-danger', lightThemeColors.danger],
    ['--color-danger-500', lightThemeColors.dangerStrong],
    ['--color-danger-200', lightThemeColors.dangerMuted],
    ['--color-warn', lightThemeColors.warning],
    ['--color-warn-500', lightThemeColors.warningStrong],
    ['--color-warn-200', lightThemeColors.warningMuted],
    ['--color-ok', lightThemeColors.success],
    ['--color-ok-500', lightThemeColors.successStrong],
    ['--panel-inset-highlight', lightElevation.panelInsetHighlight],
    ['--shadow-sm', lightElevation.shadows.small],
    ['--shadow-md', lightElevation.shadows.medium],
    ['--shadow-lg', lightElevation.shadows.large],
    /*
     * What the browser draws for itself: scrollbars, a date picker, the caret.
     *
     * Without it a light app keeps a dark scrollbar and a dark calendar
     * dropdown, which is the one part of the window a stylesheet cannot reach.
     */
    ['--list-tint', `${String(listTintPercent.light)}%`],
    ['--category-ink', `${String(categoryInkPercent.light)}%`],
    ['--list-tint-over', `${String(listTintOverPercent.light)}%`],
    ['color-scheme', 'light'],
  ];
}

/**
 * The stepped-back tones, as percentages of whatever the text colour is.
 *
 * Declared once rather than per theme: they read `--color-text` at use, so the
 * paper theme redefining that redefines all of them with it.
 */
function textToneDeclarations(): readonly CustomPropertyDeclaration[] {
  return [
    ...Object.entries(textTonePercentages).map(([tone, percentage]): CustomPropertyDeclaration => [
      `--color-text-${tone}`,
      mixedWithText(percentage),
    ]),
    ['--color-hairline', mixedWithText(hairlinePercentage)],
    ['--color-scrim', scrimColor],
  ];
}

function mixedWithText(percentage: number): string {
  return `color-mix(in srgb, var(--color-text) ${String(percentage)}%, transparent)`;
}

function paperThemeDeclarations(): readonly CustomPropertyDeclaration[] {
  return [
    ['--color-bg', paperThemeColors.background],
    ['--color-panel', paperThemeColors.panel],
    ['--color-surface', paperThemeColors.surface],
    ['--color-text', paperThemeColors.text],
    ['--color-page-title-header-background', paperThemeColors.pageTitleHeaderBackground],
    ['--color-control', paperThemeColors.control],
    ['--color-control-border', paperThemeColors.controlBorder],
    ['--color-control-border-hover', paperThemeColors.controlBorderHover],
    ['--color-text-on-accent', paperThemeColors.textOnAccent],
    ['--color-label', paperThemeColors.label],
    ['--color-divider', paperThemeColors.divider],
    ['--color-prose-heading-1', paperThemeColors.proseHeading1],
    ['--color-prose-heading-2', paperThemeColors.proseHeading2],
    ['--color-prose-heading-3', paperThemeColors.proseHeading3],
    ['--color-accent', paperThemeColors.accent],
    ['--color-accent-700', paperThemeColors.accentStrong],
  ];
}

function cardTypeDeclarations(): readonly CustomPropertyDeclaration[] {
  return cardTypes.map((cardType) => [`--color-card-${cardType}`, colorByCardType[cardType]]);
}

function assetStatusDeclarations(): readonly CustomPropertyDeclaration[] {
  return assetStatuses.map((status) => [`--color-status-${status}`, colorByAssetStatus[status]]);
}

function typographyDeclarations(): readonly CustomPropertyDeclaration[] {
  return [
    ['--font-heading', fontFamilies.heading],
    ['--font-body', fontFamilies.body],
    ['--font-mono', fontFamilies.monospace],
    ['--font-title-weight', String(titleFontWeight)],
    ['--font-heading-weight', String(headingFontWeight)],
    ['--font-heading-line-height', String(headingLineHeight)],
    ['--font-line-height-base', String(baseLineHeight)],
    ...Object.entries(fontSizesPx).map(([name, size]): CustomPropertyDeclaration => [
      `--font-size-${name}`,
      `${String(size)}px`,
    ]),
  ];
}

function shapeDeclarations(): readonly CustomPropertyDeclaration[] {
  return [
    ['--radius-panel', `${String(borderRadiusPx.panel)}px`],
    ['--radius-tag', `${String(borderRadiusPx.tag)}px`],
    ['--panel-inset-highlight', panelInsetHighlight],
    ['--shadow-sm', elevationShadows.small],
    ['--shadow-md', elevationShadows.medium],
    ['--shadow-lg', elevationShadows.large],
  ];
}

function interactionStateDeclarations(): readonly CustomPropertyDeclaration[] {
  return [
    ['--hover-row', rowHoverBackground],
    ['--hover-nav', navigationHoverBackground],
    ['--hover-tile', tileHoverBackground],
    ['--focus-ring', focusRingOutline],
    ['--focus-ring-offset', `${String(focusRingOffsetPx)}px`],
    ['--disabled-opacity', String(disabledOpacity)],
  ];
}
