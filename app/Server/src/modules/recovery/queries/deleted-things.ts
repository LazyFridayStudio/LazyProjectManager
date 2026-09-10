import { deletedThingsQuery, type DeletedThingsView, type RecoverableKind } from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { requireActor } from '../../../cqrs/request-context.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { describeKind, isRecoverableKind, RETENTION_DAYS } from '../recycle-bin.js';

/**
 * What has been deleted and can still be put back.
 *
 * Soonest to expire first, which is the point of the screen: something at the
 * top is about to stop being recoverable, and a list ordered newest-first would
 * bury exactly that.
 *
 * No paging. The bin holds a week of one studio's deletions — if it is long
 * enough to need paging, something is deleting in a loop and the list saying so
 * plainly is the useful outcome.
 */
export const deletedThingsHandler = defineQueryHandler({
  definition: deletedThingsQuery,

  async execute(_params, context): Promise<DeletedThingsView> {
    const actor = requireActor(context, deletedThingsQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'recovery.view' });

    const rows = await context.database
      .selectFrom('deletedThing')
      .leftJoin('appUser', 'appUser.id', 'deletedThing.deletedBy')
      .select([
        'deletedThing.id',
        'deletedThing.kind',
        'deletedThing.name',
        'deletedThing.about',
        'deletedThing.deletedAt',
        'deletedThing.purgeAfter',
        'appUser.displayName',
      ])
      .where('deletedThing.accountId', '=', actor.accountId)
      .orderBy('deletedThing.purgeAfter', 'asc')
      .execute();

    return {
      // A row whose recipe this version no longer has is left out rather than
      // offered: the button on it would fail, and a button that cannot work is
      // worse than an absence.
      things: rows.flatMap((row) => (isRecoverableKind(row.kind) ? [toThing(row, row.kind)] : [])),
      retentionDays: RETENTION_DAYS,
    };
  },
});

interface Row {
  id: string;
  kind: string;
  name: string;
  about: string | null;
  deletedAt: Date;
  purgeAfter: Date;
  displayName: string | null;
}

function toThing(row: Row, kind: RecoverableKind): DeletedThingsView['things'][number] {
  return {
    id: row.id,
    kind,
    what: describeKind(kind),
    name: row.name,
    about: row.about,
    deletedBy: row.displayName,
    deletedAt: row.deletedAt.toISOString(),
    purgeAfter: row.purgeAfter.toISOString(),
  };
}
