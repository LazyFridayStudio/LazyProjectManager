import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { scmProviderSchema } from '../scm-vocabulary.js';

/**
 * What a project's repository settings show.
 *
 * The secret is not here and never will be. It was shown once, where it was
 * generated; a settings screen that could show it again is a settings screen
 * that leaks it to anyone who can open the project.
 */
export const scmConnectionSchema = z.object({
  provider: scmProviderSchema,
  repoFullName: z.string(),
  endpoint: z.string().nullable(),
  /** Where the provider should send its deliveries. Built by the server, which knows its own address. */
  webhookUrl: z.string().url(),
  connectedAt: z.string(),
  /** Null until the first delivery, which is how "is this wired up?" is answered. */
  lastEventAt: z.string().nullable(),
  /** How many deliveries have landed, so a silent webhook is visible as a zero. */
  eventsReceived: z.number().int(),
  /**
   * Whether the connection can read the repository as well as hear from it.
   *
   * The ids are shown because they are what somebody checks against the forge
   * when something is wrong. The key never comes back, here or anywhere: it was
   * pasted once, and a screen that could show it again would be a way to read
   * it out of any project you can open.
   */
  appAccess: z
    .object({
      appId: z.string(),
      installationId: z.string(),
      /** When the credentials were last known to work. */
      checkedAt: z.string().nullable(),
    })
    .nullable(),
  /**
   * Why the last sync failed, when one has and none has worked since.
   *
   * Null while the sync is doing its job, so this is the current state rather
   * than a scar. Here as well as on the board header because the header has
   * room for a marker and this has room for the sentence that says what to do
   * about it — and this is the screen somebody is on when they come to.
   */
  lastSyncFailure: z
    .object({
      at: z.string(),
      reason: z.string(),
    })
    .nullable(),
});

export type ScmConnection = z.infer<typeof scmConnectionSchema>;

/**
 * The repository a project is connected to, or nothing.
 *
 * Null rather than a 404: "this project has no repository" is a normal answer
 * to a settings screen asking, not a failure to look one up.
 */
export const scmConnectionQuery = defineQuery(
  'scm.connection',
  z.object({ projectId: z.string().uuid() }),
  z.object({ connection: scmConnectionSchema.nullable() }),
);
