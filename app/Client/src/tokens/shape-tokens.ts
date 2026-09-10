/**
 * Shape and depth tokens.
 *
 * The prototype deliberately overrides the Industry design system's blueprint
 * corner marks: panels here are machined plates with a hairline border and an
 * inset highlight, not crosshair-framed wireframes. Keep that override — it is
 * the difference between the product looking finished and looking like a
 * wireframe of itself.
 */

export const borderRadiusPx = {
  /** Panels, cards, inputs and buttons. */
  panel: 5,
  /** Tags and chips. */
  tag: 3,
} as const;

export const hairlineBorderWidthPx = 1;

/** The inset highlight that reads as a machined edge on every panel. */
export const panelInsetHighlight = 'inset 0 1px 0 rgba(255,255,255,.05)';

export const elevationShadows = {
  small: '0 1px 2px rgba(0,0,0,.5)',
  medium: '0 3px 10px rgba(0,0,0,.55)',
  large: '0 12px 32px rgba(0,0,0,.65)',
} as const;
