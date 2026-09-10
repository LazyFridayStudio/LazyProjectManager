import type { Database } from '@lpm/database';
import type { WorkDone, WorkEntry } from '@lpm/shared';

import { pictureUrl } from '../files/index.js';

/** Which thing the hours were put into. Exactly one, as the table insists. */
export type WorkedOnWhat = { readonly cardId: string } | { readonly assetId: string };

export interface WorkDoneRequest {
  readonly database: Database;
  readonly what: WorkedOnWhat;
  /** Who is reading, so the panel knows which entries they may take back off. */
  readonly readerId: string;
}

/**
 * What has been logged against one card or one asset.
 *
 * One reader for both, because an entry is the same thing whichever it hangs
 * off and a card panel and an asset panel draw it the same way. A second copy
 * of this would be a second place for the total to be worked out differently.
 *
 * Newest work first, by the day it was done rather than the day it was typed:
 * somebody writing up their week on Friday would otherwise push Monday to the
 * top of the list. `created_at` breaks the tie, so two entries for the same day
 * still come back in a stable order.
 *
 * The total is summed here rather than stored anywhere. It is the sum of the
 * rows, and there is nowhere for a second copy of it to be wrong.
 */
export async function readWorkDone(request: WorkDoneRequest): Promise<WorkDone> {
  const rows = await request.database
    .selectFrom('workLog')
    .leftJoin('appUser as who', 'who.id', 'workLog.userId')
    .leftJoin('file as face', 'face.id', 'who.avatarFileId')
    .select([
      'workLog.id as id',
      'workLog.minutes as minutes',
      'workLog.workedOn as workedOn',
      'workLog.note as note',
      'workLog.userId as userId',
      'who.displayName as displayName',
      'who.initials as initials',
      'who.avatarFileId as avatarFileId',
      'face.state as avatarState',
    ])
    .where(
      'cardId' in request.what ? 'workLog.cardId' : 'workLog.assetId',
      '=',
      'cardId' in request.what ? request.what.cardId : request.what.assetId,
    )
    .orderBy('workLog.workedOn', 'desc')
    .orderBy('workLog.createdAt', 'desc')
    .execute();

  const entries = rows.map((row): WorkEntry => {
    const named = row.userId !== null && row.displayName !== null;

    return {
      id: row.id,
      who: named
        ? {
            userId: row.userId ?? '',
            displayName: row.displayName ?? '',
            initials: row.initials ?? '',
            avatarUrl: pictureUrl(row.avatarFileId, row.avatarState),
          }
        : null,
      minutes: row.minutes,
      // A `date` reads back as `YYYY-MM-DD`: the OID 1082 parser is overridden
      // in `configure-type-parsers.ts` so a day with no time and no zone stays
      // one, rather than becoming midnight somewhere.
      workedOn: row.workedOn,
      note: row.note,
      isMine: row.userId === request.readerId,
    };
  });

  return {
    entries,
    // Every entry, including the ones by people who have since left: those
    // hours were still spent on this.
    loggedMinutes: entries.reduce((total, entry) => total + entry.minutes, 0),
  };
}
