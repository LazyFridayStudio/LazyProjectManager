import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';

/**
 * Says one mention has been dealt with, and takes it off the mark.
 *
 * Pressing it in the panel is what sends this, and pressing it also opens the
 * card — so the two happen together and the count goes down as the thing you
 * were told about comes into view.
 *
 * Only yours. There is no user id here either: the row has to belong to the
 * session or it is not found, which is the same guard `identity.updateProfile`
 * runs on.
 *
 * Deliberately not "opening the card clears them". A mention is cleared by
 * acting on it rather than by passing near it: somebody who opens a card from
 * the board has not necessarily read the sentence with their name in it, and a
 * mark that clears itself when you were not looking is a mark that loses
 * things.
 */
export const seeMentionCommand = defineCommand(
  'notifications.see',
  z.object({ mentionId: z.string().uuid() }),
);
