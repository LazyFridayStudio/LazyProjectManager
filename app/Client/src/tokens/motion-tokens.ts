/**
 * How long things take to move, and the curve they move along.
 *
 * One set for the whole app. Before this, every stylesheet that wanted a fade
 * chose its own — 90ms here, 120ms there, `ease` on one and `ease-out` on the
 * next — which is a dozen slightly different fades and no way to change them
 * together. The motion helper in `components/ui/motion.ts` reads these for
 * everything that tweens, and the stylesheets read the same numbers as custom
 * properties for what is still pure CSS: a hover revealing a control.
 */

export const motionDurationMs = {
  /**
   * Something arriving: a dialog opening, a section unfolding, a message.
   *
   * Long enough to see where it came from, short enough that nobody waits on
   * it. Past about a quarter of a second a panel opening starts to feel like a
   * panel loading.
   */
  arrive: 200,
  /**
   * Something going away. Shorter than arriving, because once somebody has
   * dismissed a thing they are already looking at what is under it.
   */
  leave: 140,
  /** A hover or a drop mark answering the pointer, which must not lag behind it. */
  hint: 100,
} as const;

/** Cubic béziers, as the four numbers both CSS and the motion helper take. */
export type CubicBezier = readonly [number, number, number, number];

export const motionEasing = {
  /** Fast out of the gate and settling gently: a thing coming to rest in place. */
  arrive: [0.2, 0, 0, 1],
  /** Slow to start and gone quickly: a thing picking up speed as it leaves. */
  leave: [0.4, 0, 1, 1],
} as const satisfies Record<string, CubicBezier>;

/** A curve as CSS writes it. */
export function cubicBezierToCss(curve: CubicBezier): string {
  return `cubic-bezier(${curve.join(', ')})`;
}
