import { z } from 'zod';

import { cardAssigneeSchema } from '../board/queries/board-view.js';

export const workEntrySchema = z.object({
  id: z.string().uuid(),
  /** Null once the person has left. The hours they worked stay on the record. */
  who: cardAssigneeSchema.nullable(),
  minutes: z.number().int().positive(),
  workedOn: z.string(),
  note: z.string().nullable(),
  /** Whether the person reading this may take it back off. */
  isMine: z.boolean(),
});

export type WorkEntry = z.infer<typeof workEntrySchema>;

/**
 * What has been worked on a card or an asset, and what it adds up to.
 *
 * The total is computed rather than carried: it is a sum of the entries and
 * there is nowhere for a second copy of it to be wrong. It counts every entry,
 * including the ones by people who have since left — those hours were still
 * spent on this.
 *
 * `logged` beside `estimateMinutes` is the pair a producer actually reads. The
 * estimate is what it was expected to take; this is what it took, and the
 * interesting number is the gap.
 */
export const workDoneSchema = z.object({
  entries: z.array(workEntrySchema),
  /** Every entry added up, in minutes, the unit everything here is carried in. */
  loggedMinutes: z.number().int().nonnegative(),
});

export type WorkDone = z.infer<typeof workDoneSchema>;
