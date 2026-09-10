/** The part of a `DOMRect` this needs, so a test can make one without a browser. */
export interface Bounds {
  readonly top: number;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Offset {
  readonly x: number;
  readonly y: number;
}

/**
 * Holds a dragged thing inside the area it may be dropped in.
 *
 * A picture carried past the bottom of the strip is a picture over the buttons,
 * which is not somewhere it can go — and while it is down there its transform
 * is extending the scrollable overflow of the panel it is in, which is what let
 * a drag scroll the page away underneath itself.
 *
 * Both axes are clamped independently, so dragging along the bottom edge still
 * moves sideways rather than sticking in a corner.
 */
export function keepWithin(node: Bounds, within: Bounds, wanted: Offset): Offset {
  return {
    x: clamp(wanted.x, within.left - node.left, within.right - node.right),
    y: clamp(wanted.y, within.top - node.top, within.bottom - node.bottom),
  };
}

/**
 * Clamps, and copes with a node bigger than what holds it.
 *
 * When the low bound is above the high one there is no position that fits, and
 * the low bound is the one to take: a picture taller than the strip should sit
 * against its top rather than hanging off it.
 */
function clamp(value: number, low: number, high: number): number {
  if (low > high) return low;

  return Math.min(Math.max(value, low), high);
}
