import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';

/**
 * The kinds of thing the bin can put back.
 *
 * A closed list, because each one is a recipe on the server saying which rows
 * go back in which order. Something not named here was not kept.
 */
export const RECOVERABLE_KINDS = [
  'team',
  'permissionGroup',
  'milestone',
  'projectDoc',
  'projectRelease',
  'assetCategory',
  'card',
] as const;

export type RecoverableKind = (typeof RECOVERABLE_KINDS)[number];

export const deletedThingSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(RECOVERABLE_KINDS),
  /** What to call the kind: "Team", "Milestone". */
  what: z.string(),
  /** What the thing itself was called, copied at the moment it went. */
  name: z.string(),
  /** The line under the name: "4 people", "in Example Project". */
  about: z.string().nullable(),
  /** Null for anything the server did to itself, which is not nobody. */
  deletedBy: z.string().nullable(),
  deletedAt: z.string(),
  /** When it stops being recoverable. The whole of the promise. */
  purgeAfter: z.string(),
});

export type DeletedThing = z.infer<typeof deletedThingSchema>;

export const deletedThingsViewSchema = z.object({
  things: z.array(deletedThingSchema),
  /** How long anything put in the bin from now on will be kept, in days. */
  retentionDays: z.number().int().positive(),
});

export type DeletedThingsView = z.infer<typeof deletedThingsViewSchema>;

/**
 * What has been deleted and can still be put back, soonest to expire first.
 *
 * Soonest first rather than newest first, which is the other obvious order and
 * the wrong one: the reason to look at this list is that something in it is
 * about to stop being recoverable.
 */
export const deletedThingsQuery = defineQuery(
  'recovery.deletedThings',
  z.object({}),
  deletedThingsViewSchema,
);
