import type { Active, ClientRect, DroppableContainer } from '@dnd-kit/core';
import { describe, expect, it } from 'vitest';

import { underThePointer } from './under-the-pointer.js';

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function rectangle(box: Box): ClientRect {
  return { ...box, right: box.left + box.width, bottom: box.top + box.height };
}

/**
 * A board two columns wide: one with a card near the top of it, one empty.
 *
 * The columns are the height of the screen and the card is not, which is the
 * whole of what made an empty column unreachable.
 */
const BACKLOG = rectangle({ left: 0, top: 0, width: 200, height: 800 });
const DONE = rectangle({ left: 220, top: 0, width: 200, height: 800 });
const CARD_IN_BACKLOG = rectangle({ left: 8, top: 40, width: 184, height: 80 });

const RECTS = new Map<string, ClientRect>([
  ['backlog', BACKLOG],
  ['done', DONE],
  ['card-in-backlog', CARD_IN_BACKLOG],
]);

function droppable(id: string): DroppableContainer {
  return {
    id,
    key: id,
    data: { current: undefined },
    disabled: false,
    node: { current: null },
    rect: { current: RECTS.get(id) ?? null },
  };
}

const CARRIED_CARD: Active = {
  id: 'card-being-carried',
  data: { current: undefined },
  rect: { current: { initial: null, translated: null } },
};

interface Carry {
  readonly pointerCoordinates: { x: number; y: number } | null;
  readonly collisionRect: ClientRect;
}

function collisionsWhile(carry: Carry): string[] {
  return underThePointer({
    active: CARRIED_CARD,
    collisionRect: carry.collisionRect,
    droppableRects: RECTS,
    droppableContainers: ['backlog', 'done', 'card-in-backlog'].map(droppable),
    pointerCoordinates: carry.pointerCoordinates,
  }).map((collision) => String(collision.id));
}

describe('GIVEN a card is being carried across a board with an empty column on it', () => {
  describe('WHEN the pointer is inside the empty column', () => {
    it('THEN the empty column is what it would be dropped into', () => {
      const collisions = collisionsWhile({
        pointerCoordinates: { x: 320, y: 400 },
        collisionRect: rectangle({ left: 230, top: 360, width: 180, height: 80 }),
      });

      expect(collisions[0]).toBe('done');
    });
  });

  describe('WHEN the pointer is over a card in the column beside it', () => {
    it('THEN the card is what it would be dropped on, rather than the column around it', () => {
      const collisions = collisionsWhile({
        pointerCoordinates: { x: 100, y: 80 },
        collisionRect: rectangle({ left: 8, top: 40, width: 184, height: 80 }),
      });

      expect(collisions[0]).toBe('card-in-backlog');
    });
  });

  describe('WHEN there is no pointer, because the card is being moved by keyboard', () => {
    it('THEN the nearest column by its corners is found instead of nothing', () => {
      const collisions = collisionsWhile({ pointerCoordinates: null, collisionRect: DONE });

      expect(collisions[0]).toBe('done');
    });
  });

  describe('WHEN the pointer has left the board entirely', () => {
    it('THEN the nearest column is still offered, so a drop outside is not lost', () => {
      const collisions = collisionsWhile({
        pointerCoordinates: { x: 900, y: 400 },
        collisionRect: rectangle({ left: 810, top: 360, width: 180, height: 80 }),
      });

      expect(collisions[0]).toBe('done');
    });
  });
});
