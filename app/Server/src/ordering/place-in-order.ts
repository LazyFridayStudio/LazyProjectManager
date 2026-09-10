import { positionBetween, POSITION_STEP } from '../domain/index.js';

/**
 * Where a hand-ordered row lands, for any table that has such an order.
 *
 * The arithmetic was written for cards and is not about cards: name the two
 * rows something should sit between, work out a position between them, and
 * spread the set back out when the gap has closed. Assets want the same thing
 * inside a category, and copying a hundred and fifty lines to get it is how two
 * orderings come to disagree about what an empty list does.
 *
 * So the algorithm is here and the tables bring an adapter. Each adapter is
 * concretely typed against its own table — this file names no columns, and
 * nothing has to be cast to make it fit.
 */

/**
 * The smallest gap a midpoint is still worth taking.
 *
 * Halving a gap forty-odd times exhausts what a double can represent, and the
 * two rows either side stop having anything between them. Reindexing puts the
 * gaps back; it is rare enough that doing it the moment it is needed costs
 * nothing.
 */
const SMALLEST_USEFUL_GAP = 1e-6;

/**
 * One ordered set — a list's cards, a category's assets — as the algorithm
 * needs to see it.
 *
 * Every question excludes the row being moved, because the gap it left is what
 * everything else has already closed over.
 */
export interface OrderedRows {
  /** Where one row sits, or null when it is not in this set at all. */
  positionOf(id: string): Promise<number | null>;
  /** The nearest position above this one. */
  firstAbove(position: number): Promise<number | null>;
  /** The nearest position below this one. */
  lastBelow(position: number): Promise<number | null>;
  /** The last position in the set, which is what "goes on the end" means. */
  last(): Promise<number | null>;
  /** Every row in the set, in the order it is in now. */
  idsInOrder(): Promise<readonly string[]>;
  setPosition(id: string, position: number): Promise<void>;
}

export interface Placement {
  /** The row it should end up above. */
  readonly beforeId: string | null | undefined;
  /** The row it should end up below. */
  readonly afterId: string | null | undefined;
}

/**
 * Works out where a row lands.
 *
 * Neighbours rather than an index, because an index means something different
 * by the time it arrives — somebody else may have dropped a row above it.
 * Naming the rows it should sit between is a request that still makes sense
 * when the set has moved on.
 */
export async function placeInOrder(rows: OrderedRows, placement: Placement): Promise<number> {
  const before = await positionOf(rows, placement.beforeId);
  const after = await positionOf(rows, placement.afterId);

  const upperBound = before ?? (await neighbourAbove(rows, after));
  const lowerBound = after ?? (await neighbourBelow(rows, before));

  if (upperBound !== null && lowerBound !== null && upperBound - lowerBound < SMALLEST_USEFUL_GAP) {
    return reindexAndPlace(rows, placement);
  }

  return positionBetween(lowerBound, upperBound);
}

/** Where a brand-new row goes: the end of whatever it is joining. */
export async function placeAtEnd(rows: OrderedRows): Promise<number> {
  return positionBetween(await rows.last(), null);
}

async function positionOf(
  rows: OrderedRows,
  id: string | null | undefined,
): Promise<number | null> {
  return id === null || id === undefined ? null : rows.positionOf(id);
}

/**
 * The row directly above the one named as the lower neighbour.
 *
 * Only consulted when the caller named one side. A drop at the bottom still has
 * to land between the last row and nothing.
 */
async function neighbourAbove(
  rows: OrderedRows,
  belowPosition: number | null,
): Promise<number | null> {
  return belowPosition === null ? null : rows.firstAbove(belowPosition);
}

async function neighbourBelow(
  rows: OrderedRows,
  abovePosition: number | null,
): Promise<number | null> {
  // Neither side was named: the row goes on the end.
  return abovePosition === null ? rows.last() : rows.lastBelow(abovePosition);
}

/**
 * Spreads the set back out, then places into the room that makes.
 *
 * Rewrites every row, which is why it only runs when the gap has genuinely
 * closed rather than on every move.
 */
async function reindexAndPlace(rows: OrderedRows, placement: Placement): Promise<number> {
  const ids = await rows.idsInOrder();

  for (const [index, id] of ids.entries()) {
    await rows.setPosition(id, (index + 1) * POSITION_STEP);
  }

  const before = await positionOf(rows, placement.beforeId);
  const after = await positionOf(rows, placement.afterId);

  return positionBetween(after ?? (await neighbourBelow(rows, before)), before);
}
