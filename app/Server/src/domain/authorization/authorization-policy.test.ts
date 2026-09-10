import { describe, expect, it } from 'vitest';

import { ForbiddenError } from '../errors/domain-error.js';
import { assertCan, can, type AuthorizationActor } from './authorization-policy.js';
import type { MembershipRole } from './membership-roles.js';

const ACCOUNT_ID = 'account-1';
const OTHER_ACCOUNT_ID = 'account-2';
const SHARED_CARD_ID = 'card-shared';
const PRIVATE_CARD_ID = 'card-private';

function createActor(
  role: MembershipRole,
  sharedCardIds: readonly string[] = [],
): AuthorizationActor {
  return { userId: 'user-1', accountId: ACCOUNT_ID, role, sharedCardIds };
}

describe('GIVEN an actor and a resource in different accounts', () => {
  describe('WHEN any action is attempted', () => {
    it('THEN it is refused, whatever the role', () => {
      expect(
        can({
          actor: createActor('owner'),
          action: 'project.view',
          resource: { accountId: OTHER_ACCOUNT_ID },
        }),
      ).toBe(false);
    });
  });
});

describe('GIVEN an actor with a ranked role', () => {
  describe('WHEN an owner archives a project', () => {
    it('THEN it is allowed', () => {
      expect(
        can({
          actor: createActor('owner'),
          action: 'project.archive',
          resource: { accountId: ACCOUNT_ID },
        }),
      ).toBe(true);
    });
  });

  describe('WHEN a lead archives a project', () => {
    it('THEN it is refused, because archiving is an owner action', () => {
      expect(
        can({
          actor: createActor('lead'),
          action: 'project.archive',
          resource: { accountId: ACCOUNT_ID },
        }),
      ).toBe(false);
    });
  });

  describe('WHEN a member works on the board', () => {
    const member = createActor('member');
    const resource = { accountId: ACCOUNT_ID, cardId: PRIVATE_CARD_ID };

    it('THEN they may move a card', () => {
      expect(can({ actor: member, action: 'card.move', resource })).toBe(true);
    });

    it('THEN they may not manage the lists', () => {
      expect(can({ actor: member, action: 'board.manageList', resource })).toBe(false);
    });
  });

  describe('WHEN a viewer works on the board', () => {
    const viewer = createActor('viewer');
    const resource = { accountId: ACCOUNT_ID, cardId: PRIVATE_CARD_ID };

    it('THEN they may read a card', () => {
      expect(can({ actor: viewer, action: 'card.view', resource })).toBe(true);
    });

    it('THEN they may not create one', () => {
      expect(can({ actor: viewer, action: 'card.create', resource })).toBe(false);
    });
  });
});

describe('GIVEN an outsourcer with one card shared with them', () => {
  const outsourcer = createActor('outsourcer', [SHARED_CARD_ID]);

  describe('WHEN they comment on the shared card', () => {
    it('THEN it is allowed', () => {
      expect(
        can({
          actor: outsourcer,
          action: 'card.comment',
          resource: { accountId: ACCOUNT_ID, cardId: SHARED_CARD_ID },
        }),
      ).toBe(true);
    });
  });

  describe('WHEN they open a card that was not shared', () => {
    it('THEN it is refused', () => {
      expect(
        can({
          actor: outsourcer,
          action: 'card.view',
          resource: { accountId: ACCOUNT_ID, cardId: PRIVATE_CARD_ID },
        }),
      ).toBe(false);
    });
  });

  describe('WHEN they attempt a board-wide action', () => {
    it('THEN it is refused, since there is no card to check the share list against', () => {
      expect(
        can({ actor: outsourcer, action: 'board.viewList', resource: { accountId: ACCOUNT_ID } }),
      ).toBe(false);
    });
  });

  describe('WHEN they attempt a member-only action on the shared card', () => {
    it('THEN it is refused, because an outsourcer never gains an action by rank', () => {
      expect(
        can({
          actor: outsourcer,
          action: 'card.create',
          resource: { accountId: ACCOUNT_ID, cardId: SHARED_CARD_ID },
        }),
      ).toBe(false);
    });
  });
});

describe('GIVEN a handler that asserts permission instead of branching', () => {
  describe('WHEN the action is permitted', () => {
    it('THEN it returns quietly and the handler carries on', () => {
      expect(() => {
        assertCan({
          actor: createActor('owner'),
          action: 'settings.manage',
          resource: { accountId: ACCOUNT_ID },
        });
      }).not.toThrow();
    });
  });

  describe('WHEN the action is refused', () => {
    it('THEN it throws ForbiddenError carrying the FORBIDDEN failure code', () => {
      try {
        assertCan({
          actor: createActor('viewer'),
          action: 'settings.manage',
          resource: { accountId: ACCOUNT_ID },
        });
        expect.unreachable('assertCan should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenError);
        expect((error as ForbiddenError).code).toBe('FORBIDDEN');
      }
    });
  });
});
