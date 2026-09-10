import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';

/**
 * Whether one backing service is answering.
 *
 * `latencyMs` is recorded even when a dependency is healthy, because a slow
 * Postgres is the earliest warning that the board view is about to miss its
 * budget.
 */
export const dependencyHealthSchema = z.object({
  name: z.enum(['postgres', 'redis', 'objectStorage']),
  reachable: z.boolean(),
  latencyMs: z.number().nonnegative(),
  detail: z.string().optional(),
});

export type DependencyHealth = z.infer<typeof dependencyHealthSchema>;

export const healthViewSchema = z.object({
  /** `ok` only when every dependency is reachable. */
  status: z.enum(['ok', 'degraded']),
  /** Shown on the connect-to-server screen so an operator can confirm the box. */
  serverName: z.string(),
  version: z.string(),
  /**
   * Because this ticks, the query's ETag changes every second and the route will
   * never answer 304 for it. That is the right trade here — the payload is tiny
   * and a cached health check would defeat the point — but it is why this one
   * query behaves differently from every other.
   */
  uptimeSeconds: z.number().nonnegative(),
  /** False until the first-run setup wizard has been completed. */
  setupCompleted: z.boolean(),
  dependencies: z.array(dependencyHealthSchema),
});

export type HealthView = z.infer<typeof healthViewSchema>;

/**
 * The query behind the prototype's connect-to-server step. It is deliberately
 * unauthenticated: a client must be able to confirm it is pointed at a real
 * LazyProjectManager install before it has any credentials to offer.
 */
export const healthQuery = defineQuery('system.health', z.object({}), healthViewSchema);
