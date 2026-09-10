import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';

export const agentTokenSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdAt: z.string(),
  /** Null for a key nothing has ever presented. */
  lastUsedAt: z.string().nullable(),
  /** Set once it has been stopped. A revoked key stays listed as revoked. */
  revokedAt: z.string().nullable(),
});

export type AgentToken = z.infer<typeof agentTokenSchema>;

export const agentSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  initials: z.string(),
  avatarUrl: z.string().nullable(),
  /**
   * The permission groups it holds, which is the whole of what it may do.
   *
   * None is the state it is made in: it can read, and nothing else, until
   * somebody gives it a group. The same shape a person's are in, because the
   * screen that switches them is the same screen.
   */
  permissionGroups: z.array(z.object({ groupId: z.string().uuid(), name: z.string() })),
  tokens: z.array(agentTokenSchema),
});

export type Agent = z.infer<typeof agentSchema>;

export const agentsViewSchema = z.object({ agents: z.array(agentSchema) });

export type AgentsView = z.infer<typeof agentsViewSchema>;

/**
 * Every agent on the install, and the keys each of them has.
 *
 * Never the secrets — there are none to return. Only the hash is stored, and
 * this lists what a person needs in order to decide whether a key still matters
 * and whether to stop it: what it is called, when it was made, and when it was
 * last used.
 *
 * Behind `user.manage`, like the people screen it sits on. An agent is somebody
 * who can act on the install, so who may make one is the same question as who
 * may add a person.
 */
export const agentsQuery = defineQuery('identity.agents', z.object({}), agentsViewSchema);
