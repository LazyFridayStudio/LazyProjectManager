/**
 * What finishes a card.
 *
 * **The list a card sits in is the answer, and it is the only answer.** A card
 * on the list the board finishes on is closed; a card anywhere else is open.
 * `closed_at` is the stamp that says when it got there, not a second opinion
 * about whether it did.
 *
 * One rule because there were nearly two. The issue sync has always read the
 * last list as closed — closing an issue moves the card, moving the card closes
 * the issue — while `closed_at` was a column no screen ever wrote. Had the
 * board grown a flag of its own, a card closed by hand in Ready for review
 * would have been pushed to the forge as open, and an issue closed on the forge
 * would have moved a card without stamping it. Every half hour the two would
 * have taken turns being right.
 *
 * So closing is a move, and this is the only place that turns one into a stamp.
 */

export interface ClosingStamp {
  /** Whether the list the card is landing in is the one the board finishes on. */
  readonly isFinishingList: boolean;
  /** The stamp the card carries now, so an old one is not overwritten. */
  readonly closedAt: Date | null;
  readonly now: Date;
}

/**
 * The `closed_at` a card should carry once it has landed.
 *
 * The stamp it already had is kept when it is already closed, because a card
 * dragged up the Done column has not finished twice. Leaving the last list
 * clears it: a card taken back out is work somebody has picked up again, and a
 * stamp saying otherwise would outlive the fact.
 */
export function closingStampFor({ isFinishingList, closedAt, now }: ClosingStamp): Date | null {
  if (!isFinishingList) {
    return null;
  }

  return closedAt ?? now;
}
