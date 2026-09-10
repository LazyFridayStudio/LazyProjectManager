import { describe, expect, it } from 'vitest';

import {
  getInvalidationChannel,
  getScopesForEvent,
  invalidationFrameSchema,
  serverFrameSchema,
  watchFrameSchema,
} from './frames.js';

const PROJECT_ID = '018f0000-0000-7000-8000-0000000000p0'.replace('p0', 'a0');

describe('GIVEN an event that has just been recorded', () => {
  describe('WHEN it is about a card', () => {
    it('THEN the board, that card and the sidebar count all go stale', () => {
      // A card's chip is on the board, its detail is in its own cache, and the
      // sidebar counts the open ones.
      for (const name of ['board.cardCreated', 'board.cardMoved', 'board.subtaskAdded']) {
        expect([...getScopesForEvent(name)].sort()).toEqual(['board', 'card', 'projects']);
      }
    });
  });

  describe('WHEN it is about an asset', () => {
    it('THEN the library, the panel and the sidebar tree all go stale', () => {
      // A tag shows on the tile and in the panel; a category being deleted
      // rearranges the library and the tree beside it.
      for (const name of ['assets.tagged', 'assets.categoryDeleted', 'assets.referencePromoted']) {
        expect([...getScopesForEvent(name)].sort()).toEqual(['asset', 'assets', 'projects']);
      }
    });
  });

  describe('WHEN a file has arrived or been thumbnailed', () => {
    it('THEN everything that could be showing it goes stale', () => {
      // The event does not say whether it landed on a card or an asset, and
      // four refetches on an upload is nothing next to somebody staring at a
      // panel that will not show the picture they just added.
      for (const name of ['files.uploaded', 'files.thumbnailed']) {
        expect([...getScopesForEvent(name)].sort()).toEqual(['asset', 'assets', 'board', 'card']);
      }
    });
  });

  describe('WHEN it is a comment', () => {
    it('THEN only the card goes stale, because no chip shows a comment', () => {
      expect([...getScopesForEvent('board.commented')]).toEqual(['card']);
    });
  });

  describe('WHEN it is about a list', () => {
    it('THEN the board goes stale', () => {
      expect([...getScopesForEvent('board.listArchived')]).toEqual(['board']);
    });
  });

  describe('WHEN it is about the project itself', () => {
    it('THEN the launcher goes stale', () => {
      expect([...getScopesForEvent('projects.projectArchived')]).toEqual(['projects']);
    });
  });

  describe('WHEN it is something nobody has taught this yet', () => {
    it('THEN the board is refetched rather than nothing being', () => {
      // Refetching too much is a wasted request; refetching too little is a
      // screen quietly showing something that is no longer true.
      expect([...getScopesForEvent('board.somethingNew')]).toEqual(['board']);
    });
  });
});

describe('GIVEN frames on the wire', () => {
  describe('WHEN a client asks to watch a project', () => {
    it('THEN the frame is accepted', () => {
      expect(watchFrameSchema.safeParse({ type: 'watch', projectId: PROJECT_ID }).success).toBe(
        true,
      );
    });

    it('THEN one naming something that is not a project is refused', () => {
      expect(
        watchFrameSchema.safeParse({ type: 'watch', projectId: 'drowned-reach' }).success,
      ).toBe(false);
    });
  });

  describe('WHEN the server says something went stale', () => {
    it('THEN the frame carries what to refetch and nothing about the change', () => {
      const frame = {
        type: 'invalidate',
        projectId: PROJECT_ID,
        scopes: ['board'],
        cardId: null,
      };

      const parsed = invalidationFrameSchema.safeParse(frame);

      expect(parsed.success).toBe(true);
      expect(Object.keys(parsed.success ? parsed.data : {}).sort()).toEqual([
        'cardId',
        'projectId',
        'scopes',
        'type',
      ]);
    });

    it('THEN a frame with no scopes is refused, having nothing to say', () => {
      expect(
        invalidationFrameSchema.safeParse({
          type: 'invalidate',
          projectId: PROJECT_ID,
          scopes: [],
          cardId: null,
        }).success,
      ).toBe(false);
    });

    it('THEN the client can tell one kind of frame from the other', () => {
      expect(serverFrameSchema.safeParse({ type: 'watching', projectId: PROJECT_ID }).success).toBe(
        true,
      );
      expect(serverFrameSchema.safeParse({ type: 'nonsense' }).success).toBe(false);
    });
  });
});

describe('GIVEN an account being published for', () => {
  describe('WHEN its channel is named', () => {
    it('THEN two accounts never share one', () => {
      const first = getInvalidationChannel('018f0000-0000-7000-8000-0000000000a1');
      const second = getInvalidationChannel('018f0000-0000-7000-8000-0000000000a2');

      expect(first).not.toBe(second);
      expect(first).toContain('018f0000-0000-7000-8000-0000000000a1');
    });
  });
});
