import { getInvalidationChannel, type InvalidationFrame } from '@lpm/shared';
import type { Redis } from 'ioredis';
import { beforeEach, describe, expect, it } from 'vitest';

import { InvalidationHub, type FrameSink } from './invalidation-hub.js';

const ACCOUNT = '018f0000-0000-7000-8000-0000000000a1';
const OTHER_ACCOUNT = '018f0000-0000-7000-8000-0000000000a2';
const PROJECT = '018f0000-0000-7000-8000-0000000000b1';
const OTHER_PROJECT = '018f0000-0000-7000-8000-0000000000b2';

/** A Redis subscriber whose messages the test delivers by hand. */
function createSubscriber(): {
  redis: Redis;
  channels: string[];
  deliver: (channel: string, payload: string) => void;
} {
  const channels: string[] = [];
  let listener: ((channel: string, payload: string) => void) | null = null;

  const redis = {
    on: (_event: string, handler: (channel: string, payload: string) => void) => {
      listener = handler;
    },
    subscribe: (channel: string) => {
      channels.push(channel);
      return Promise.resolve(1);
    },
  } as unknown as Redis;

  return {
    redis,
    channels,
    deliver: (channel, payload) => {
      listener?.(channel, payload);
    },
  };
}

function createSink(): FrameSink & { sent: string[] } {
  const sent: string[] = [];

  return { sent, send: (payload) => sent.push(payload) };
}

function frame(projectId: string): string {
  const invalidation: InvalidationFrame = {
    type: 'invalidate',
    projectId,
    scopes: ['board'],
    cardId: null,
  };

  return JSON.stringify(invalidation);
}

describe('GIVEN sockets watching boards', () => {
  let subscriber: ReturnType<typeof createSubscriber>;
  let hub: InvalidationHub;

  beforeEach(() => {
    subscriber = createSubscriber();
    hub = new InvalidationHub(subscriber.redis);
  });

  describe('WHEN a socket starts watching', () => {
    it('THEN its account is subscribed to, and it is told it is listening', async () => {
      const sink = createSink();

      await hub.watch({ sink, accountId: ACCOUNT, projectId: PROJECT });

      expect(subscriber.channels).toEqual([getInvalidationChannel(ACCOUNT)]);
      expect(sink.sent).toEqual([JSON.stringify({ type: 'watching', projectId: PROJECT })]);
    });

    it('THEN a second socket on the same account does not subscribe again', async () => {
      await hub.watch({ sink: createSink(), accountId: ACCOUNT, projectId: PROJECT });
      await hub.watch({ sink: createSink(), accountId: ACCOUNT, projectId: OTHER_PROJECT });

      expect(subscriber.channels).toHaveLength(1);
      expect(hub.watcherCount).toBe(2);
    });
  });

  describe('WHEN something changes', () => {
    it('THEN only the sockets watching that project hear about it', async () => {
      const watching = createSink();
      const elsewhere = createSink();

      await hub.watch({ sink: watching, accountId: ACCOUNT, projectId: PROJECT });
      await hub.watch({ sink: elsewhere, accountId: ACCOUNT, projectId: OTHER_PROJECT });

      subscriber.deliver(getInvalidationChannel(ACCOUNT), frame(PROJECT));

      expect(watching.sent).toHaveLength(2);
      expect(elsewhere.sent).toHaveLength(1);
    });

    it('THEN a message for another account reaches nobody', async () => {
      const sink = createSink();
      await hub.watch({ sink, accountId: ACCOUNT, projectId: PROJECT });

      // The same project id on a channel it does not belong to must not be
      // enough; the account is the boundary.
      subscriber.deliver(getInvalidationChannel(OTHER_ACCOUNT), frame(PROJECT));

      expect(sink.sent).toHaveLength(1);
    });

    it('THEN a message that is not a frame is dropped rather than thrown', async () => {
      const sink = createSink();
      await hub.watch({ sink, accountId: ACCOUNT, projectId: PROJECT });

      expect(() => {
        subscriber.deliver(getInvalidationChannel(ACCOUNT), 'not json at all');
        subscriber.deliver(getInvalidationChannel(ACCOUNT), '{"type":"something-else"}');
      }).not.toThrow();
      expect(sink.sent).toHaveLength(1);
    });
  });

  describe('WHEN a socket goes', () => {
    it('THEN it is forgotten, and stops being sent to', async () => {
      const sink = createSink();
      await hub.watch({ sink, accountId: ACCOUNT, projectId: PROJECT });

      hub.forget(sink);
      subscriber.deliver(getInvalidationChannel(ACCOUNT), frame(PROJECT));

      expect(hub.watcherCount).toBe(0);
      expect(sink.sent).toHaveLength(1);
    });
  });
});
