import { closestCorners, pointerWithin, type CollisionDetection } from '@dnd-kit/core';

/**
 * What is under the pointer, or the nearest thing when the pointer is over
 * nothing at all.
 *
 * `closestCorners` on its own measures the dragged thing's corners against every
 * droppable's corners, which a tall container loses: a board column runs the
 * full height of the screen, so its corners are half a screen away from a card
 * being carried at mid-height, while a card in the next column along sits right
 * under the pointer and wins the comparison. A column with cards in it is
 * entered through those cards, so the one that could not be reached at all was
 * the empty one.
 *
 * Corners stay as the fallback because the pointer is not always inside
 * anything — it leaves the board, and the keyboard sensor has no pointer to be
 * inside with.
 */
export const underThePointer: CollisionDetection = (args) => {
  const pointed = pointerWithin(args);

  return pointed.length > 0 ? pointed : closestCorners(args);
};
