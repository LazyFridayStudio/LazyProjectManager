import { describe, expect, it } from 'vitest';

import { readDelivery } from './read-delivery.js';

const PUSH = {
  ref: 'refs/heads/feature/LPMT-ART-2-crane-textures',
  compare: 'https://example.test/compare/aaa...bbb',
  pusher: { name: 'jake' },
  head_commit: { timestamp: '2026-08-19T09:00:00Z' },
  commits: [
    {
      id: '1c8b04e7d92a536f0b8e41a7c25d93f60a4b8e17',
      message: 'feat: paint the crane diffuse\n\nCard LPMT-ART-2.',
      url: 'https://example.test/commit/1c8b04e',
      timestamp: '2026-08-19T09:00:00Z',
      author: { name: 'Jake Winters' },
    },
  ],
};

describe('GIVEN a delivery from a repository', () => {
  describe('WHEN it is a push', () => {
    it('THEN each commit becomes something the card can show', () => {
      const [, commit] = readDelivery('github', 'push', PUSH);

      expect(commit?.kind).toBe('commit');
      expect(commit?.ref).toBe('1c8b04e');
      expect(commit?.author).toBe('Jake Winters');
      expect(commit?.url).toBe('https://example.test/commit/1c8b04e');
      expect(commit?.occurredAt.toISOString()).toBe('2026-08-19T09:00:00.000Z');
    });

    it('THEN the card shows the subject, but the keys are looked for in all of it', () => {
      // A card showing thirty lines of commit body is a card nobody can see the
      // rest of — and a key is as often in the body as the subject.
      const [, commit] = readDelivery('github', 'push', PUSH);

      expect(commit?.message).toBe('feat: paint the crane diffuse');
      expect(commit?.searchIn).toContain('LPMT-ART-2');
    });

    it('THEN the branch is its own thing, because it names a card the commits may not', () => {
      const [branch] = readDelivery('github', 'push', PUSH);

      expect(branch?.kind).toBe('branch');
      expect(branch?.ref).toBe('feature/LPMT-ART-2-crane-textures');
      expect(branch?.searchIn).toBe('feature/LPMT-ART-2-crane-textures');
      expect(branch?.author).toBe('jake');
    });

    it('THEN a tag is not a branch', () => {
      const activities = readDelivery('github', 'push', { ...PUSH, ref: 'refs/tags/v1.0' });

      expect(activities.filter((activity) => activity.kind === 'branch')).toEqual([]);
    });

    it('THEN Gitea is read the same way, because it says the same thing', () => {
      expect(readDelivery('gitea', 'push', PUSH)).toHaveLength(2);
    });

    it('THEN GitLab is recognised by what the body says it is', () => {
      const activities = readDelivery('gitlab', 'Push Hook', {
        object_kind: 'push',
        ref: 'refs/heads/main',
        user_name: 'jake',
        commits: [
          { id: 'abcdef1234567', message: 'fix: LPMT-BUG-1', timestamp: '2026-08-19T09:00:00Z' },
        ],
      });

      expect(activities.map((activity) => activity.kind)).toEqual(['branch', 'commit']);
    });
  });

  describe('WHEN it is a pull request', () => {
    it('THEN it is one thing, named by its number', () => {
      const [request] = readDelivery('github', 'pull_request', {
        action: 'opened',
        sender: { login: 'jake' },
        pull_request: {
          number: 6,
          title: 'Raise the shadow bias',
          body: 'The key is only on the branch.',
          html_url: 'https://example.test/pull/6',
          updated_at: '2026-08-19T10:00:00Z',
          head: { ref: 'bugfix/LPMT-BUG-1-shadow-acne' },
        },
      });

      expect(request?.kind).toBe('pull_request');
      expect(request?.ref).toBe('#6');
      expect(request?.message).toBe('Raise the shadow bias');
      expect(request?.author).toBe('jake');
    });

    it('THEN the branch it came from is searched too, which is often the only clue', () => {
      const [request] = readDelivery('github', 'pull_request', {
        pull_request: {
          number: 6,
          title: 'Raise the shadow bias',
          head: { ref: 'bugfix/LPMT-BUG-1-shadow-acne' },
        },
      });

      expect(request?.searchIn).toContain('LPMT-BUG-1');
    });

    it('THEN GitLab spells it differently and is read anyway', () => {
      const [request] = readDelivery('gitlab', 'Merge Request Hook', {
        object_attributes: {
          iid: 12,
          title: 'LPMT-TASK-1 mix pass',
          source_branch: 'audio/mix',
          url: 'https://example.test/-/merge_requests/12',
        },
      });

      expect(request?.ref).toBe('#12');
      expect(request?.url).toBe('https://example.test/-/merge_requests/12');
    });
  });

  describe('WHEN it is something this does not read', () => {
    it('THEN nothing comes of it, rather than an exception', () => {
      expect(readDelivery('github', 'star', { starred_at: 'now' })).toEqual([]);
      expect(readDelivery('github', 'push', null)).toEqual([]);
      expect(readDelivery('github', 'push', 'not an object')).toEqual([]);
    });

    it('THEN a payload with the right names and the wrong shapes is survived', () => {
      // Somebody else's JSON, three providers, changed whenever they like. A
      // field of the wrong type means that part is missing, not that the batch
      // stops.
      const activities = readDelivery('github', 'push', {
        ref: 42,
        commits: [{ id: null }, 'not an object', { id: 'abc1234', message: 5 }],
      });

      expect(activities).toHaveLength(1);
      expect(activities[0]?.ref).toBe('abc1234');
      expect(activities[0]?.message).toBe('');
    });

    it('THEN a commit with no timestamp still sorts somewhere sensible', () => {
      const before = Date.now();
      const [activity] = readDelivery('github', 'push', { commits: [{ id: 'abc1234' }] });

      expect(activity?.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    });
  });
});
