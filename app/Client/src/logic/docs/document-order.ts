/**
 * Where a document ends up, said as the two it lands between.
 *
 * The command takes neighbours rather than a position, so this is the whole of
 * the arithmetic the screen does: work out the order a move would make, then
 * read off what the moved document is now sitting between.
 *
 * Both ways of moving one — dragging it along the row, and pressing it left or
 * right — end here, which is what stops the two from disagreeing about what
 * "one place to the left" means.
 */
export interface DocumentNeighbours {
  /** The document it should end up in front of. Null means it goes last. */
  readonly beforeDocId: string | null;
  /** The document it should end up behind. Null means it goes first. */
  readonly afterDocId: string | null;
}

/**
 * The neighbours a document would have if it were moved to a place in the row.
 *
 * `null` when the move changes nothing: it is already there, the place is off
 * either end of the row, or the document is not in it. A command sent for a
 * move that changes nothing is a write, an invalidation and a refetch to leave
 * the screen exactly as it was.
 */
export function neighboursAfterMove(
  ids: readonly string[],
  movedId: string,
  toIndex: number,
): DocumentNeighbours | null {
  const from = ids.indexOf(movedId);

  if (from === -1 || toIndex === from) return null;
  if (toIndex < 0 || toIndex >= ids.length) return null;

  const moved = [...ids];

  moved.splice(from, 1);
  moved.splice(toIndex, 0, movedId);

  return {
    // The one it is now in front of, and the one it is now behind. Read off the
    // order rather than worked out from the direction, because the two are the
    // same answer and one of them is easy to get backwards.
    beforeDocId: moved[toIndex + 1] ?? null,
    afterDocId: moved[toIndex - 1] ?? null,
  };
}

/** The neighbours a document would have if it were pressed one place along. */
export function neighboursAfterStep(
  ids: readonly string[],
  movedId: string,
  step: -1 | 1,
): DocumentNeighbours | null {
  const from = ids.indexOf(movedId);

  return from === -1 ? null : neighboursAfterMove(ids, movedId, from + step);
}
