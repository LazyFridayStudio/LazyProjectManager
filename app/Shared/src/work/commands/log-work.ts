import { z } from 'zod';

import { calendarDateSchema } from '../../projects/project-vocabulary.js';
import { defineCommand } from '../../envelope/command-definition.js';
import { MAXIMUM_ESTIMATE_MINUTES } from '../../board/duration.js';

/** A note on an entry: what the hours went on, in a line. */
export const workNoteSchema = z.string().trim().max(280);

/**
 * Records time somebody worked.
 *
 * Against a card or against an asset, and exactly one of them — an entry about
 * both would be counted twice by anything totalling either.
 *
 * **Always your own hours.** There is no `userId` on this, and that is the whole
 * of the rule: an entry means "I did this", and a sheet somebody else can write
 * into is one nobody can vouch for. A producer who wants to correct a forgotten
 * Friday asks the person to log it.
 *
 * Minutes, read from what somebody typed by `parseDuration` — `2d 4h`, `90m`, a
 * bare number meaning hours. The browser does the reading and sends the number,
 * so both sides agree on what a day is before anything is stored.
 */
export const logWorkCommand = defineCommand(
  'work.log',
  z.object({
    cardId: z.string().uuid().optional(),
    assetId: z.string().uuid().optional(),
    /** Above zero: an entry for no time is a note, and there is a field for that. */
    minutes: z.number().int().min(1).max(MAXIMUM_ESTIMATE_MINUTES),
    /**
     * The day the work was done, which is not the day it is being typed in.
     *
     * Nobody logs as they go. Friday afternoon gets written up on Monday, and a
     * sheet that recorded Monday would be wrong about the only thing it is for.
     */
    workedOn: calendarDateSchema,
    note: workNoteSchema.optional(),
  }),
);

/**
 * Takes an entry back off.
 *
 * Removed rather than edited: an hour typed as ten is fixed by deleting it and
 * logging it again, and an edit history on a timesheet is a great deal of
 * machinery for a mistake that takes ten seconds to redo.
 *
 * Your own only, for the same reason nobody else can write one.
 */
export const removeWorkCommand = defineCommand(
  'work.remove',
  z.object({ entryId: z.string().uuid() }),
);
