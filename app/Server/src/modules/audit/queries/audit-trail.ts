import { sql } from '@lpm/database';
import { auditTrailQuery, AUDIT_PAGE_SIZE, type AuditTrailView } from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { requireActor, type RequestContext } from '../../../cqrs/request-context.js';
import { pictureUrl } from '../../files/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';

/**
 * What has happened on this install, newest first.
 *
 * Reads `domain_event` — the table every command already appends to inside its
 * own transaction — so the trail cannot disagree with what actually happened.
 * There is no second log to keep in step, and no way for a write to succeed
 * without appearing here.
 *
 * Owner-only. It names who did what and when, across every project including the
 * ones a given member was never added to.
 */
export const auditTrailHandler = defineQueryHandler({
  definition: auditTrailQuery,

  async execute(params: AuditFilters, context): Promise<AuditTrailView> {
    const actor = requireActor(context, auditTrailQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'audit.view' });

    const rows = await selectPage(context.database, actor.accountId, params);
    const page = rows.slice(0, AUDIT_PAGE_SIZE);

    return {
      entries: page.map(toEntry),
      // There was one more than a page, so there is another page.
      nextCursor: rows.length > AUDIT_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
    };
  },
});

/** What narrows the trail. Everything optional; absent means all of it. */
interface AuditFilters {
  readonly before?: string;
  readonly projectId?: string;
  readonly kind?: string;
  readonly search?: string;
}

type AuditRow = Awaited<ReturnType<typeof selectPage>>[number];

/**
 * Everything an entry can be about, joined once.
 *
 * Left joins, all of them: an event outlives the thing it happened to, and a
 * trail that dropped the rows whose card was deleted would be hiding exactly the
 * entries somebody came looking for.
 *
 * Its own function because it is the shape of the trail, and what follows is the
 * question being asked of it. A reader looking for one does not want to walk the
 * other.
 */
function trailFor(database: RequestContext['database'], accountId: string) {
  return (
    database
      .selectFrom('domainEvent')
      .leftJoin('appUser', 'appUser.id', 'domainEvent.actorId')
      .leftJoin('file as actorAvatar', 'actorAvatar.id', 'appUser.avatarFileId')
      .leftJoin('card', (join) =>
        join
          .onRef('card.id', '=', 'domainEvent.aggregateId')
          .on('domainEvent.aggregateType', '=', 'card'),
      )
      .leftJoin('project', (join) =>
        join
          .onRef('project.id', '=', 'domainEvent.aggregateId')
          .on('domainEvent.aggregateType', '=', 'project'),
      )
      .leftJoin('team', (join) =>
        join
          .onRef('team.id', '=', 'domainEvent.aggregateId')
          .on('domainEvent.aggregateType', '=', 'team'),
      )
      // The person an entry is *about*, which is not the person who did it.
      .leftJoin('appUser as subject', (join) =>
        join
          .onRef('subject.id', '=', 'domainEvent.aggregateId')
          .on('domainEvent.aggregateType', '=', 'user'),
      )
      .select([
        'domainEvent.id',
        'domainEvent.name',
        'domainEvent.aggregateType',
        'domainEvent.aggregateId',
        'domainEvent.occurredAt',
        'domainEvent.actorId',
        'appUser.displayName',
        'appUser.initials',
        'appUser.avatarFileId as actorAvatarFileId',
        'actorAvatar.state as actorAvatarState',
        'card.cardKey',
        'project.name as projectName',
        'team.name as teamName',
        'subject.displayName as subjectName',
      ])
      .where('domainEvent.accountId', '=', accountId)
      .orderBy('domainEvent.id', 'desc')
      // One more than a page, so "is there another page" is answered without a
      // second count over a table that only grows.
      .limit(AUDIT_PAGE_SIZE + 1)
  );
}

/** One page of the trail, newest first, narrowed by whatever was asked. */
function selectPage(database: RequestContext['database'], accountId: string, params: AuditFilters) {
  let query = trailFor(database, accountId);

  if (params.before !== undefined) {
    // Ids are time-ordered, so reading back from one is reading back in time.
    query = query.where('domainEvent.id', '<', params.before);
  }

  const { projectId, kind } = params;

  if (projectId !== undefined) {
    // Either the project itself, or a card in it. An event about a list or a
    // file names neither, and is left out of a project's own trail rather than
    // being guessed at.
    query = query.where((builder) =>
      builder.or([
        builder.eb('project.id', '=', projectId),
        builder.eb('card.projectId', '=', projectId),
        /*
         * Or it is about a card, and the event says which project itself.
         *
         * The join above answers this for every card that still exists, which
         * was all of them until a card could be deleted. A card that has gone
         * leaves its entries with nothing to join to — including the one
         * somebody filtering a project's trail most wants, which is who deleted
         * it.
         *
         * Narrowed to card events rather than read off any payload that happens
         * to carry a project. Most of them do, and trusting all of them would
         * quietly pull in the list and file entries the rule above leaves out
         * on purpose.
         */
        builder.and([
          builder.eb('domainEvent.aggregateType', '=', 'card'),
          builder.eb(
            sql<string>`${builder.ref('domainEvent.payload')} ->> 'projectId'`,
            '=',
            projectId,
          ),
        ]),
      ]),
    );
  }

  if (kind !== undefined) {
    query = query.where('domainEvent.aggregateType', '=', kind);
  }

  const search = params.search?.trim();

  if (search !== undefined && search !== '') {
    /*
     * What it happened to, who did it, or what happened.
     *
     * The event's own name rather than the phrase the screen puts it into:
     * `board.cardDeleted` is what the row holds, and "deleted" finds it. The
     * phrase lives in the client's vocabulary and is not a thing SQL can see.
     */
    const like = `%${search}%`;

    query = query.where((builder) =>
      builder.or([
        builder.eb('domainEvent.name', 'ilike', like),
        builder.eb('card.cardKey', 'ilike', like),
        builder.eb('card.title', 'ilike', like),
        builder.eb('project.name', 'ilike', like),
        builder.eb('team.name', 'ilike', like),
        builder.eb('subject.displayName', 'ilike', like),
        builder.eb('appUser.displayName', 'ilike', like),
      ]),
    );
  }

  return query.execute();
}

function toEntry(row: AuditRow): AuditTrailView['entries'][number] {
  return {
    id: row.id,
    name: row.name,
    occurredAt: row.occurredAt.toISOString(),
    subject: {
      kind: readSubjectKind(row.aggregateType),
      id: row.aggregateId,
      label: row.cardKey ?? row.projectName ?? row.teamName ?? row.subjectName ?? null,
    },
    actor:
      row.actorId === null || row.displayName === null
        ? null
        : {
            userId: row.actorId,
            displayName: row.displayName,
            // The ones the account stores, rather than ones derived again here
            // — an avatar on the board and a name in the trail should never be
            // two different abbreviations of the same person.
            initials: row.initials ?? '',
            avatarUrl: pictureUrl(row.actorAvatarFileId, row.actorAvatarState),
          },
  };
}

const SUBJECT_KINDS = new Set(['card', 'project', 'board', 'install', 'user', 'team']);

/**
 * An aggregate type nothing recognises still has to draw.
 *
 * `install` rather than a refusal: a trail that failed on one unfamiliar row
 * would hide every row behind it, which is the opposite of what it is for.
 */
function readSubjectKind(
  aggregateType: string,
): AuditTrailView['entries'][number]['subject']['kind'] {
  return SUBJECT_KINDS.has(aggregateType)
    ? (aggregateType as AuditTrailView['entries'][number]['subject']['kind'])
    : 'install';
}
