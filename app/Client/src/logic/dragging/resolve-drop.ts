/**
 * Where a dragged thing should end up, expressed the way the commands take it.
 *
 * Neighbours rather than an index, because an index means something different
 * by the time it reaches the server — somebody else may have dropped two more
 * things in above it. Every list in this product that a person orders by hand
 * moves this way, so the arithmetic lives here once.
 */
export interface Drop {
  readonly movedId: string;
  /** What it should end up in front of. Null means it goes last. */
  readonly beforeId: string | null;
  /** What it should end up behind. Null means it goes first. */
  readonly afterId: string | null;
  /** The whole list in its new order, for the screen to draw straight away. */
  readonly order: readonly string[];
}

/**
 * Turns a drop onto another item into a move.
 *
 * The thing lands where the one it was dropped on is now — which is what a drag
 * looks like, and what the list shows while the pointer is down. Its neighbours
 * are therefore read from the list *without* it, because the gap it left is
 * what everything else has already closed over.
 *
 * Returns null when the drop changes nothing, so the caller does not send a
 * command that would do no work.
 */
export function resolveDrop(
  items: readonly { readonly id: string }[],
  activeId: string,
  overId: string,
): Drop | null {
  if (activeId === overId) return null;

  const from = items.findIndex((item) => item.id === activeId);
  const to = items.findIndex((item) => item.id === overId);

  if (from === -1 || to === -1) return null;

  const without = items.filter((item) => item.id !== activeId);

  // It is inserted at `to` in the list without it, so the item already at `to`
  // is the one it comes before, and the one at `to - 1` is the one it comes
  // after. This holds dragging either way — getting it wrong in one direction
  // only is what an off-by-one here looks like.
  const after = without[to - 1] ?? null;
  const before = without[to] ?? null;

  return {
    movedId: activeId,
    beforeId: before?.id ?? null,
    afterId: after?.id ?? null,
    order: [
      ...without.slice(0, to).map((item) => item.id),
      activeId,
      ...without.slice(to).map((item) => item.id),
    ],
  };
}

/**
 * A list arranged the way somebody just dropped it.
 *
 * Anything the server has since gained — somebody else's addition, or one of
 * ours — is not in the order that was dropped, and belongs on the end rather
 * than nowhere.
 */
export function inDroppedOrder<TItem extends { readonly id: string }>(
  items: readonly TItem[],
  order: readonly string[],
): readonly TItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const placed = order.flatMap((id) => byId.get(id) ?? []);

  return [...placed, ...items.filter((item) => !order.includes(item.id))];
}

/** Whether the server's own order already says what was dropped. */
export function isDroppedOrder(
  items: readonly { readonly id: string }[],
  order: readonly string[],
): boolean {
  return items.length === order.length && items.every((item, index) => item.id === order[index]);
}
