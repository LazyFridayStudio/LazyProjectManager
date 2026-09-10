import { describe, expect, it } from 'vitest';

import { deliveryWantsASync } from './delivery-wants-a-sync.js';

describe('GIVEN a delivery from a forge', () => {
  describe('WHEN it is about an issue', () => {
    it('THEN the board may be behind, whatever happened to it', () => {
      // Opened, closed, reopened, retitled, relabelled: every one of them is a
      // thing the board mirrors, and none was read before.
      for (const action of ['opened', 'closed', 'reopened', 'edited', 'labeled']) {
        expect(deliveryWantsASync('github', 'issues', { action })).toBe(true);
      }
    });

    it('THEN GitLab is asked by its own name for the same event', () => {
      expect(deliveryWantsASync('gitlab', 'Issue Hook', {})).toBe(true);
      expect(deliveryWantsASync('gitlab', 'issues', {})).toBe(false);
    });
  });

  describe('WHEN a pull request settles', () => {
    it('THEN a closed one wants a sync, because that is how an issue closes', () => {
      expect(deliveryWantsASync('github', 'pull_request', { action: 'closed' })).toBe(true);
    });

    it('THEN one merely opened does not', () => {
      // It names cards and changes none of them.
      expect(deliveryWantsASync('github', 'pull_request', { action: 'opened' })).toBe(false);
      expect(deliveryWantsASync('github', 'pull_request', { action: 'synchronize' })).toBe(false);
    });

    it('THEN GitLab says the action somewhere else, and is still read', () => {
      expect(
        deliveryWantsASync('gitlab', 'Merge Request Hook', {
          object_attributes: { action: 'merge' },
        }),
      ).toBe(true);
    });
  });

  describe('WHEN it is anything else', () => {
    it('THEN nothing is brought forward', () => {
      expect(deliveryWantsASync('github', 'push', {})).toBe(false);
      expect(deliveryWantsASync('github', 'issue_comment', { action: 'created' })).toBe(false);
      expect(deliveryWantsASync('github', 'ping', {})).toBe(false);
    });
  });

  describe('WHEN the payload is not what it should be', () => {
    it('THEN it answers rather than throwing, like everything else that reads one', () => {
      expect(deliveryWantsASync('github', 'pull_request', null)).toBe(false);
      expect(deliveryWantsASync('github', 'pull_request', 'nonsense')).toBe(false);
      expect(deliveryWantsASync('github', 'pull_request', [1, 2, 3])).toBe(false);
      // The event name alone is enough for an issue, whatever came with it.
      expect(deliveryWantsASync('github', 'issues', null)).toBe(true);
    });
  });
});
