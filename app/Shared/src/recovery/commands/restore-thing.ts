import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';

/**
 * Puts a deleted thing back.
 *
 * Named by the bin row rather than by the thing, because the thing does not
 * exist to be named: its id is gone from every table it used to be in, and the
 * bin row is the only handle there is.
 */
export const restoreDeletedThingCommand = defineCommand(
  'recovery.restore',
  z.object({ deletedThingId: z.string().uuid() }),
);

/**
 * Throws a thing away now rather than in a week.
 *
 * Somebody deleting a document with a password in it should not have to wait
 * seven days for it to actually go. Irreversible, and said so on the button.
 */
export const purgeDeletedThingCommand = defineCommand(
  'recovery.purge',
  z.object({ deletedThingId: z.string().uuid() }),
);
