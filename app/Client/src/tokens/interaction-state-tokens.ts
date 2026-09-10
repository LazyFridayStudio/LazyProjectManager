/**
 * Interaction states.
 *
 * Hover is expressed as a `color-mix` against the surface underneath rather than
 * a fixed colour, so a row and a tile hovering over different backgrounds stay
 * consistent with each other without hand-picked values per surface.
 */

export const rowHoverBackground = 'color-mix(in srgb, var(--color-text) 4%, transparent)';
export const navigationHoverBackground = 'color-mix(in srgb, var(--color-text) 6%, transparent)';
/*
 * Mixed into the surface a tile sits on rather than into a literal grey.
 *
 * It was `#3a3a3a`, which is what `--color-surface` is on the dark theme —
 * so this is the same colour there, and the difference is that a tile on a
 * light ground no longer goes dark when somebody points at it.
 */
export const tileHoverBackground =
  'color-mix(in srgb, var(--color-accent) 7%, var(--color-surface))';

export const focusRingOutline = '2px solid var(--color-accent)';
export const focusRingOffsetPx = 2;

export const disabledOpacity = 0.45;

/**
 * How much of a list's own colour tints the column it heads.
 *
 * A whisper, and it has to stay a whisper on both themes — which is why it is a
 * number here rather than in the board's stylesheet. The same six per cent that
 * is barely there over `#333` is a wash over `#eeeff1`: a bright ground shows a
 * hue far more readily than a dark one, and four saturated columns side by side
 * stop reading as panels with a coloured edge and start reading as coloured
 * panels. The top border is what says which list this is; the ground only
 * agrees with it quietly.
 */
export const listTintPercent = { dark: 6, light: 3 } as const;

/**
 * How much of a category's own colour survives in the words it names.
 *
 * A number here rather than in the library's stylesheet for the same reason
 * `listTintPercent` is, and then some: this one is read rather than glanced at.
 * `PICKABLE_COLORS` sits at one tone — three-quarters saturated, two-thirds
 * light — which is chosen to be *seen* on either theme, and being seen as a
 * swatch is not the same as being read as a word. Against the lightest ground
 * either theme puts behind a heading, every one of the sixteen straight on the
 * ground measures between 3.29:1 and 9.45:1 on dark and between 1.16:1 and
 * 3.01:1 on light — olive on `#f7f8f9` is 1.16, which is a name nobody can see.
 *
 * So the colour is mixed toward whatever the theme's text is, which pulls it
 * light on a dark ground and dark on a light one without either being written
 * down. Seventy and thirty-five are the most colour that leaves all sixteen at
 * 4.5:1 or better against every ground either theme puts behind one of these
 * names — which on light is a hovered row of the sidebar's tree rather than
 * anything in the library, because mixing toward a dark text colour moves the
 * name *toward* a ground the hover has already darkened. The worst left are
 * violet at 4.68 and yellow at 4.89.
 *
 * A colour somebody mixed themselves in the browser's picker is not covered by
 * that — nothing can cover it — but it gets the same pull toward the text,
 * which is what keeps a near-white one from disappearing.
 */
export const categoryInkPercent = { dark: 70, light: 35 } as const;

/** The same, for the list a card is being dragged over. Louder on purpose. */
export const listTintOverPercent = { dark: 12, light: 7 } as const;
