import { positionBetween, POSITION_STEP } from '../board/default-lists.js';

/**
 * The smallest gap a midpoint is still worth taking.
 *
 * Halving a gap forty-odd times exhausts what a double can represent, and the
 * two rows either side stop having anything between them.
 */
const SMALLEST_USEFUL_GAP = 1e-6;

/** A row in an ordered set, as the arithmetic here needs it. */
export interface PlacedRow {
  readonly id: string;
  readonly position: number;
}

/** Where a row is being dropped, said as the two rows it lands between. */
export interface Placement {
  /** The row it should end up in front of. */
  readonly before: string | null | undefined;
  /** The row it should end up behind. */
  readonly after: string | null | undefined;
}

export interface Landing {
  /** The position to write on the row being moved. */
  readonly position: number;
  /**
   * Every sibling that has to be rewritten first, at its new position.
   *
   * Empty almost always. It fills only when the gap has genuinely closed, which
   * is the one case where a move costs a write per row rather than one.
   */
  readonly spread: readonly PlacedRow[];
}

/**
 * Works out where something dropped between two neighbours lands.
 *
 * The arithmetic of an ordered set, without the table it happens to be stored
 * in. The board's lists and a project's documents are the same problem — a
 * handful of rows a person arranges by hand — and they were one function that
 * knew about `list` until documents needed the other half of it.
 *
 * The caller reads the siblings and writes the answer. What is here is only the
 * part that has no opinion about either: which gap the neighbours describe, and
 * whether that gap still has room in it.
 *
 * The row being moved must not be in `siblings`. It is being taken out and put
 * back, so its own position is not one of the bounds — leaving it in makes a
 * move by one place land on the position it already had.
 */
export function placeAmong(siblings: readonly PlacedRow[], placement: Placement): Landing {
  const gap = gapFor(siblings, placement);

  if (!isTooTightToSplit(gap)) {
    return { position: positionBetween(gap.lower, gap.upper), spread: [] };
  }

  // Spread everything back out, then place into the room that makes. Rewrites
  // every sibling, which is why it runs only once the gap has closed rather
  // than on every move.
  const spread = siblings.map((row, index) => ({
    id: row.id,
    position: (index + 1) * POSITION_STEP,
  }));
  const room = gapFor(spread, placement);

  return { position: positionBetween(room.lower, room.upper), spread };
}

/** The two positions a move has to land between. Null on a side means an end. */
interface Gap {
  readonly lower: number | null;
  readonly upper: number | null;
}

/**
 * The gap the named neighbours describe.
 *
 * The row it goes in front of decides, when both were named and they disagree:
 * a set that has moved on under a drag is likelier to have lost the one behind,
 * and one bound with a real neighbour beats two bounds with a guess.
 */
function gapFor(siblings: readonly PlacedRow[], placement: Placement): Gap {
  const inFront = siblings.findIndex((row) => row.id === placement.before);
  const behind = siblings.findIndex((row) => row.id === placement.after);

  if (inFront !== -1) {
    return { lower: positionAt(siblings, inFront - 1), upper: positionAt(siblings, inFront) };
  }

  if (behind !== -1) {
    return { lower: positionAt(siblings, behind), upper: positionAt(siblings, behind + 1) };
  }

  // Neither neighbour is there any more. The end is where something goes when
  // nothing says otherwise, which is where a new one goes too.
  return { lower: positionAt(siblings, siblings.length - 1), upper: null };
}

function isTooTightToSplit(gap: Gap): boolean {
  return gap.lower !== null && gap.upper !== null && gap.upper - gap.lower < SMALLEST_USEFUL_GAP;
}

function positionAt(siblings: readonly PlacedRow[], index: number): number | null {
  return siblings[index]?.position ?? null;
}
