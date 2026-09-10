import { readMinorUnits } from '@lpm/database';
import { cardDetailQuery, type CardDetailView } from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { pictureUrl } from '../../files/index.js';
import { fileUrl } from '../../files/index.js';
import type { RequestContext } from '../../../cqrs/request-context.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { CardNotFoundError, type MembershipRole } from '../../../domain/index.js';
import {
  assertProjectPermission,
  canReachProject,
  loadMembershipRole,
  mayDo,
} from '../../projects/project-access.js';
import { readWorkDone } from '../../work/read-work-done.js';

/**
 * One card, in full, for the detail panel.
 *
 * Both people on it are joined here rather than fetched by the panel, so opening
 * a card is one request however many names are on it.
 */
export const cardDetailHandler = defineQueryHandler({
  definition: cardDetailQuery,

  async execute(params: { cardId: string }, context): Promise<CardDetailView> {
    const actor = requireActor(context, cardDetailQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'card.view' });

    const card = await selectCard({ context, actor, role }, params.cardId);

    if (card === undefined) {
      // Also what a card in another account, or in a project this actor was
      // never added to, looks like.
      throw new CardNotFoundError();
    }

    return toDetail({ card, context, actor, role });
  },
});

interface CardDetailQuery {
  readonly context: RequestContext;
  readonly actor: RequestActor;
  readonly role: MembershipRole;
}

async function selectCard(request: CardDetailQuery, cardId: string) {
  const { context, actor } = request;

  const query = context.database
    .selectFrom('card')
    .innerJoin('project', 'project.id', 'card.projectId')
    .innerJoin('list', 'list.id', 'card.listId')
    .leftJoin('appUser as assignee', 'assignee.id', 'card.assigneeId')
    .leftJoin('file as assigneeAvatar', 'assigneeAvatar.id', 'assignee.avatarFileId')
    .leftJoin('appUser as reporter', 'reporter.id', 'card.reporterId')
    .leftJoin('file as reporterAvatar', 'reporterAvatar.id', 'reporter.avatarFileId')
    .leftJoin('milestone', 'milestone.id', 'card.milestoneId')
    .leftJoin('card as legend', 'legend.id', 'card.legendId')
    .select([
      'card.id as id',
      'card.cardKey as cardKey',
      'card.projectId as projectId',
      'project.slug as projectSlug',
      'card.listId as listId',
      'list.name as listName',
      'card.title as title',
      'card.description as description',
      'card.acceptanceCriteria as acceptanceCriteria',
      'card.type as type',
      'card.priority as priority',
      'card.points as points',
      'card.estimateMinutes as estimateMinutes',
      'card.discipline as discipline',
      'card.fixVersion as fixVersion',
      'card.dueOn as dueOn',
      'card.blocked as blocked',
      'card.blockedReason as blockedReason',
      'card.closedAt as closedAt',
      'card.isLegend as isLegend',
      'legend.id as legendId',
      'legend.cardKey as legendKey',
      'legend.title as legendTitle',
      'card.createdAt as createdAt',
      'card.updatedAt as updatedAt',
      'assignee.id as assigneeId',
      'assignee.displayName as assigneeName',
      'assignee.initials as assigneeInitials',
      'assignee.avatarFileId as assigneeAvatarFileId',
      'assigneeAvatar.state as assigneeAvatarState',
      'reporter.id as reporterId',
      'milestone.id as milestoneId',
      'milestone.name as milestoneName',
      'reporter.displayName as reporterName',
      'reporter.initials as reporterInitials',
      'reporter.avatarFileId as reporterAvatarFileId',
      'reporterAvatar.state as reporterAvatarState',
    ])
    .where('card.id', '=', cardId)
    .where('card.accountId', '=', actor.accountId)
    .where(canReachProject(request));

  return query.executeTakeFirst();
}

/**
 * The cards under a legend, in the order the board reads.
 *
 * Only asked for when the card is a legend, because for every other card the
 * answer is the empty list and the statement is a round trip to learn it.
 *
 * Closed cards stay: the question a legend answers is "what is in this clump",
 * and a clump you cannot see the finished half of does not say how far along it
 * is. The list each one sits in comes with it, which is the column somebody
 * scans.
 */
async function loadChildren(
  context: RequestContext,
  legendId: string,
): Promise<CardDetailView['children']> {
  const rows = await context.database
    .selectFrom('card')
    .innerJoin('list', 'list.id', 'card.listId')
    .select([
      'card.id as id',
      'card.cardKey as cardKey',
      'card.title as title',
      'card.type as type',
      'card.closedAt as closedAt',
      'list.name as listName',
    ])
    .where('card.legendId', '=', legendId)
    .orderBy('list.position')
    .orderBy('card.position')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    cardKey: row.cardKey,
    title: row.title,
    type: row.type,
    listName: row.listName,
    closed: row.closedAt !== null,
  }));
}

/** The most a card shows before it is a wall rather than a history. */
const MAXIMUM_SCM_ACTIVITY = 50;

/**
 * The lists hanging off a card, fetched together.
 *
 * Separate statements rather than one join: joining them would multiply every
 * comment by every subtask, and the panel opens once rather than on every frame
 * the way the board redraws.
 */
async function loadActivity(
  context: RequestContext,
  cardId: string,
): Promise<
  Pick<
    CardDetailView,
    'subtasks' | 'comments' | 'links' | 'attachments' | 'scmActivity' | 'assetLinks' | 'lists'
  >
> {
  const [subtasks, comments, links, attachments, scmActivity, assetLinks, lists] =
    await Promise.all([
      loadSubtasks(context, cardId),
      loadComments(context, cardId),
      loadLinks(context, cardId),
      loadAttachments(context, cardId),
      loadScmActivity(context, cardId),
      loadAssetLinks(context, cardId),
      loadLists(context, cardId),
    ]);

  return { subtasks, comments, links, attachments, scmActivity, assetLinks, lists };
}

/**
 * Every list on this card's board, in the order they sit in.
 *
 * Read from the card rather than passed in from the board, because the panel
 * opens over the asset library too — a control that worked on one screen and not
 * the other would be worse than not having one.
 */
async function loadLists(
  context: RequestContext,
  cardId: string,
): Promise<CardDetailView['lists']> {
  return context.database
    .selectFrom('list')
    .innerJoin('board', 'board.id', 'list.boardId')
    .innerJoin('card', 'card.projectId', 'board.projectId')
    .select(['list.id', 'list.name', 'list.color'])
    .where('card.id', '=', cardId)
    .where('list.archivedAt', 'is', null)
    .orderBy('list.position')
    .execute();
}

/**
 * The assets this card is about.
 *
 * The category comes along because an asset's name means different things in
 * different ones — half a studio's libraries contain something called "Well".
 */
async function loadAssetLinks(
  context: RequestContext,
  cardId: string,
): Promise<CardDetailView['assetLinks']> {
  return context.database
    .selectFrom('cardAssetLink')
    .innerJoin('asset', 'asset.id', 'cardAssetLink.assetId')
    .innerJoin('assetCategory', 'assetCategory.id', 'asset.categoryId')
    .select([
      'cardAssetLink.id as linkId',
      'asset.id as assetId',
      'asset.name',
      'asset.status',
      'assetCategory.name as categoryName',
    ])
    .where('cardAssetLink.cardId', '=', cardId)
    .orderBy('asset.name')
    .execute();
}

/**
 * What the repository has said about this card.
 *
 * Capped, because a long-lived card on a busy repository accumulates commits
 * without limit and the panel only ever shows the recent ones. Nothing is lost:
 * the deliveries they were read from are still there.
 */
async function loadScmActivity(
  context: RequestContext,
  cardId: string,
): Promise<CardDetailView['scmActivity']> {
  const rows = await context.database
    .selectFrom('scmLink')
    .select(['kind', 'ref', 'url', 'author', 'message', 'occurredAt'])
    .where('cardId', '=', cardId)
    .orderBy('occurredAt', 'desc')
    .limit(MAXIMUM_SCM_ACTIVITY)
    .execute();

  return rows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() }));
}

/**
 * The files on a card that actually arrived.
 *
 * Filtered to stored, so an upload somebody started and abandoned never shows
 * as an attachment nobody can open. Each one is signed here rather than being
 * given a permanent address, so nothing in the bucket has to be public.
 */
async function loadAttachments(
  context: RequestContext,
  cardId: string,
): Promise<CardDetailView['attachments']> {
  const rows = await context.database
    .selectFrom('cardAttachment')
    .innerJoin('file', 'file.id', 'cardAttachment.fileId')
    .select([
      'cardAttachment.id as id',
      'cardAttachment.createdAt as uploadedAt',
      'file.id as fileId',
      'file.storageKey as storageKey',
      'file.filename as filename',
      'file.mime as mime',
      'file.bytes as bytes',
    ])
    .where('cardAttachment.cardId', '=', cardId)
    .where('file.state', '=', 'stored')
    .orderBy('cardAttachment.createdAt')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    fileId: row.fileId,
    filename: row.filename,
    mime: row.mime,
    bytes: readMinorUnits(row.bytes),
    url: fileUrl(row.fileId),
    uploadedAt: row.uploadedAt.toISOString(),
  }));
}

async function loadSubtasks(
  context: RequestContext,
  cardId: string,
): Promise<CardDetailView['subtasks']> {
  return context.database
    .selectFrom('subtask')
    .select(['id', 'title', 'done'])
    .where('cardId', '=', cardId)
    .orderBy('position')
    .execute();
}

async function loadComments(
  context: RequestContext,
  cardId: string,
): Promise<CardDetailView['comments']> {
  const rows = await context.database
    .selectFrom('comment')
    .leftJoin('appUser as author', 'author.id', 'comment.authorId')
    .leftJoin('file as authorAvatar', 'authorAvatar.id', 'author.avatarFileId')
    .select([
      'comment.id as id',
      'comment.body as body',
      'comment.createdAt as createdAt',
      'comment.editedAt as editedAt',
      'author.id as authorId',
      'author.displayName as authorName',
      'author.initials as authorInitials',
      'author.avatarFileId as authorAvatarFileId',
      'authorAvatar.state as authorAvatarState',
    ])
    .where('comment.cardId', '=', cardId)
    .where('comment.deletedAt', 'is', null)
    .orderBy('comment.createdAt')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    author: toPerson({
      userId: row.authorId,
      displayName: row.authorName,
      initials: row.authorInitials,
      avatarFileId: row.authorAvatarFileId,
      avatarState: row.authorAvatarState,
    }),
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
  }));
}

async function loadLinks(
  context: RequestContext,
  cardId: string,
): Promise<CardDetailView['links']> {
  const rows = await context.database
    .selectFrom('cardLink')
    .innerJoin('card as other', 'other.id', 'cardLink.toCardId')
    .select([
      'cardLink.id as id',
      'cardLink.kind as kind',
      'other.id as cardId',
      'other.cardKey as cardKey',
      'other.title as title',
      'other.type as type',
      'other.closedAt as closedAt',
    ])
    .where('cardLink.fromCardId', '=', cardId)
    .orderBy('cardLink.createdAt')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    cardId: row.cardId,
    cardKey: row.cardKey,
    title: row.title,
    type: row.type,
    closed: row.closedAt !== null,
  }));
}

interface PersonColumns {
  readonly userId: string | null;
  readonly displayName: string | null;
  readonly initials: string | null;
  readonly avatarFileId: string | null;
  readonly avatarState: string | null;
}

function toPerson(person: PersonColumns): CardDetailView['assignee'] {
  const { userId, displayName, initials } = person;

  if (userId === null || displayName === null || initials === null) {
    return null;
  }

  return {
    userId,
    displayName,
    initials,
    avatarUrl: pictureUrl(person.avatarFileId, person.avatarState),
  };
}

/**
 * The row and everything hanging off it, as the panel draws it.
 *
 * Apart from the handler because it is a mapping: the handler decides whether
 * this actor may see the card, and this says what the card is. Nothing here can
 * refuse anybody.
 */
interface DetailRequest {
  readonly card: NonNullable<Awaited<ReturnType<typeof selectCard>>>;
  readonly context: RequestContext;
  readonly actor: RequestActor;
  readonly role: MembershipRole;
}

async function toDetail(request: DetailRequest): Promise<CardDetailView> {
  const { card, context, actor, role } = request;

  return {
    id: card.id,
    cardKey: card.cardKey,
    projectId: card.projectId,
    projectSlug: card.projectSlug,
    listId: card.listId,
    listName: card.listName,
    title: card.title,
    description: card.description,
    acceptanceCriteria: card.acceptanceCriteria,
    type: card.type,
    priority: card.priority,
    points: card.points,
    estimateMinutes: card.estimateMinutes,
    assignee: toPerson({
      userId: card.assigneeId,
      displayName: card.assigneeName,
      initials: card.assigneeInitials,
      avatarFileId: card.assigneeAvatarFileId,
      avatarState: card.assigneeAvatarState,
    }),
    reporter: toPerson({
      userId: card.reporterId,
      displayName: card.reporterName,
      initials: card.reporterInitials,
      avatarFileId: card.reporterAvatarFileId,
      avatarState: card.reporterAvatarState,
    }),
    milestone:
      card.milestoneId === null || card.milestoneName === null
        ? null
        : { id: card.milestoneId, name: card.milestoneName },
    discipline: card.discipline,
    fixVersion: card.fixVersion,
    dueOn: card.dueOn,
    blocked: card.blocked,
    blockedReason: card.blockedReason,
    closedAt: card.closedAt?.toISOString() ?? null,
    isLegend: card.isLegend,
    legend:
      card.legendId === null || card.legendKey === null || card.legendTitle === null
        ? null
        : { id: card.legendId, cardKey: card.legendKey, title: card.legendTitle },
    children: card.isLegend ? await loadChildren(context, card.id) : [],
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
    ...(await loadActivity(context, card.id)),
    work: await readWorkDone({
      database: context.database,
      what: { cardId: card.id },
      readerId: actor.userId,
    }),
    canDelete: mayDo({ actor, role, action: 'card.delete' }),
  };
}
