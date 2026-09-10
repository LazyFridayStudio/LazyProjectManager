import { getInvalidationChannel, getScopesForEvent, type InvalidationFrame } from '@lpm/shared';
import type { Redis } from 'ioredis';

import type { DomainEventConsumer, DomainEventRecord } from './drain-domain-events.js';

/**
 * Turns domain events into "this went stale" for whoever is watching.
 *
 * Published to Redis rather than pushed straight at a socket, because the worker
 * and the API are separate processes — and will be separate machines the first
 * time one install runs two of either.
 *
 * Nothing about what changed travels: a frame names the project and which caches
 * it touched, and the browser refetches through the query it already uses.
 */
export function createInvalidationPublisher(redis: Redis): DomainEventConsumer {
  return {
    name: 'invalidation',

    async handle(event: DomainEventRecord): Promise<void> {
      const projectId = readProjectId(event);

      if (projectId === null) {
        // An event with no project behind it — an install being set up — has no
        // board for anybody to be looking at.
        return;
      }

      const frame: InvalidationFrame = {
        type: 'invalidate',
        projectId,
        scopes: [...getScopesForEvent(event.name)],
        cardId: event.aggregateType === 'card' ? event.aggregateId : null,
      };

      await redis.publish(getInvalidationChannel(event.accountId), JSON.stringify(frame));
    },
  };
}

/**
 * The project an event happened in.
 *
 * Every command that touches a board puts it in the payload; a project's own
 * events are about the project itself, so its aggregate id is the answer.
 */
function readProjectId(event: DomainEventRecord): string | null {
  if (event.aggregateType === 'project') {
    return event.aggregateId;
  }

  const payload = event.payload as { projectId?: unknown };

  return typeof payload.projectId === 'string' ? payload.projectId : null;
}
