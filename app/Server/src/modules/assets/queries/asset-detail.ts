import {
  assetDetailQuery,
  type AssetDetailView,
  type AssetFile,
  type AssetReference,
  type AssetTab,
  type AssetTabBlock,
  type CardAssignee,
  type FileState,
  type LinkedAsset,
} from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { pictureUrl } from '../../files/index.js';
import { fileUrl, originalFileUrl } from '../../files/index.js';
import {
  requireActor,
  type RequestActor,
  type RequestContext,
} from '../../../cqrs/request-context.js';
import { AssetNotFoundError, type MembershipRole } from '../../../domain/index.js';
import {
  assertProjectPermission,
  canReachProject,
  loadMembershipRole,
  mayDo,
} from '../../projects/project-access.js';
import { readWorkDone } from '../../work/read-work-done.js';

/**
 * One asset, with the category it is filed under and the project it belongs to.
 *
 * Visibility is folded into the statement, as it is on the board: their role,
 * the projects they are on, and what their teams were granted. An asset they
 * cannot reach reads as one that does not exist, because saying otherwise tells
 * them it does.
 */
export const assetDetailHandler = defineQueryHandler({
  definition: assetDetailQuery,

  async execute(params: { assetId: string }, context): Promise<AssetDetailView> {
    const actor = requireActor(context, assetDetailQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    /*
     * The one handler in the product that asked nobody anything.
     *
     * `selectAsset` scopes by account and by what the actor reaches, so it was
     * never a way into another studio's library — but a query with no permission
     * on it is one that cannot be denied, and `Deny — view asset` has to mean
     * something everywhere or it means nothing anywhere.
     */
    assertProjectPermission({ actor, role, action: 'asset.view' });

    const row = await selectAsset({
      database: context.database,
      actor,
      role,
      assetId: params.assetId,
    });

    if (row === undefined) {
      throw new AssetNotFoundError();
    }

    const [cards, linkedAssets, references, files, tags, worked, work] = await Promise.all([
      selectCards(context.database, row.id),
      selectLinkedAssets(context.database, row.id),
      selectReferences(context.database, row.id),
      selectFiles(context.database, row.id),
      selectTags(context.database, row.id),
      selectTabs(context.database, row.id),
      readWorkDone({
        database: context.database,
        what: { assetId: row.id },
        readerId: actor.userId,
      }),
    ]);

    return {
      ...toDetail(row),
      work,
      references: references.map(toReference),
      files: files.map(toAssetFile),
      tags: tags.map((row) => row.tag),
      tabs: worked.tabs,
      overview: worked.overview,
      // Kysely types a SQL boolean as one that might arrive as a number, since
      // some drivers hand one back. `pg` does not, and the view says boolean.
      cards: cards.map((card) => ({ ...card, closed: Boolean(card.closed) })),
      linkedAssets: linkedAssets.map(toLinkedAsset),
      // Asked once here rather than worked out again on the screen, so the
      // Delete button and the command behind it cannot disagree about who may.
      canDelete: mayDo({ actor, role, action: 'asset.delete' }),
      canLink: mayDo({ actor, role, action: 'asset.link' }),
      canManageTemplates: mayDo({ actor, role, action: 'asset.manageTemplate' }),
    };
  },
});

interface AssetLookup {
  readonly database: RequestContext['database'];
  readonly actor: RequestActor;
  readonly role: MembershipRole;
  readonly assetId: string;
}

/**
 * The asset, with everything the panel names it by.
 *
 * Visibility is folded in, as it is on the board, by the one expression that
 * answers how much of a project somebody reaches.
 */
function selectAsset({ database, actor, role, assetId }: AssetLookup) {
  return database
    .selectFrom('asset')
    .innerJoin('assetCategory', 'assetCategory.id', 'asset.categoryId')
    .innerJoin('project', 'project.id', 'asset.projectId')
    .leftJoin('appUser as assignee', 'assignee.id', 'asset.assigneeId')
    .leftJoin('file as assigneeAvatar', 'assigneeAvatar.id', 'assignee.avatarFileId')
    .leftJoin('appUser as reporter', 'reporter.id', 'asset.reporterId')
    .leftJoin('file as reporterAvatar', 'reporterAvatar.id', 'reporter.avatarFileId')
    .select([
      'asset.id',
      'asset.assetKey',
      'asset.name',
      'asset.phase',
      'asset.description',
      'asset.estimatedCostMinor',
      'asset.dueOn',
      'asset.assigneeId',
      'asset.reporterId',
      'asset.createdAt',
      'asset.updatedAt',
      'assetCategory.id as categoryId',
      'assetCategory.name as categoryName',
      'assetCategory.color as categoryColor',
      'project.id as projectId',
      'project.slug as projectSlug',
      'project.currency as projectCurrency',
      'project.archivedAt as projectArchivedAt',
      'assignee.displayName as assigneeName',
      'assignee.initials as assigneeInitials',
      'assignee.avatarFileId as assigneeAvatarFileId',
      'assigneeAvatar.state as assigneeAvatarState',
      'reporter.displayName as reporterName',
      'reporter.initials as reporterInitials',
      'reporter.avatarFileId as reporterAvatarFileId',
      'reporterAvatar.state as reporterAvatarState',
    ])
    .where('asset.id', '=', assetId)
    .where('asset.accountId', '=', actor.accountId)
    .where(canReachProject({ actor, role }))
    .executeTakeFirst();
}

/**
 * Every picture of this asset, the first one first.
 *
 * A second statement rather than a join, for the reason the cards are: joining
 * would repeat every field of the asset once per reference, and an asset with a
 * full sheet has more pictures than it has anything else.
 */
function selectReferences(database: RequestContext['database'], assetId: string) {
  return database
    .selectFrom('assetReference')
    .innerJoin('file', 'file.id', 'assetReference.fileId')
    .select(['assetReference.id', 'assetReference.fileId', 'file.filename', 'file.state'])
    .where('assetReference.assetId', '=', assetId)
    .orderBy('assetReference.position')
    .execute();
}

/**
 * Turns a reference into a link the browser can load.
 *
 * The thumbnail when there is one — a bounded 640px image fills the panel's
 * slot, and pulling a 60MB source render to do it would make opening an asset
 * feel broken.
 *
 * The original when there is not, which is the case for the first seconds of
 * every upload: the worker makes thumbnails after the fact, and a picture
 * somebody has just added should appear when they add it rather than the next
 * time they open the panel. It costs the full file for those few seconds and is
 * worth it.
 *
 * Null only while the upload has not been confirmed, when neither key points at
 * anything yet.
 */
function toReference(reference: {
  id: string;
  fileId: string;
  filename: string;
  state: FileState;
}): AssetReference {
  return {
    id: reference.id,
    filename: reference.filename,
    // Null until the upload is confirmed: a sheet that drew a tile for a file
    // that never arrived would be a broken picture nobody could explain.
    url: reference.state === 'stored' ? fileUrl(reference.fileId) : null,
  };
}

/**
 * What the asset is made of, in the order somebody added them.
 *
 * Left joined to `file`, because half of these rows are a URL and have no file
 * behind them at all — that is the whole point of the table.
 */
function selectFiles(database: RequestContext['database'], assetId: string) {
  return database
    .selectFrom('assetFile')
    .leftJoin('file', 'file.id', 'assetFile.fileId')
    .select([
      'assetFile.id',
      'assetFile.label',
      'assetFile.url',
      'assetFile.fileId',
      'assetFile.tabId',
      'file.bytes',
      'file.state',
    ])
    .where('assetFile.assetId', '=', assetId)
    .orderBy('assetFile.position')
    .execute();
}

type AssetFileRow = Awaited<ReturnType<typeof selectFiles>>[number];

/**
 * Where to go for the file, whichever kind it is.
 *
 * `/api/f/<id>?full` rather than a signed link: a signature lasts ten minutes,
 * and a panel somebody left open over lunch would hand them a download that
 * refuses. The route signs a fresh one per request and checks the session
 * again while it is at it.
 */
function toAssetFile(row: AssetFileRow): AssetFile {
  return {
    id: row.id,
    label: row.label,
    href: row.fileId === null ? (row.url ?? '') : originalFileUrl(row.fileId),
    stored: row.fileId !== null,
    // `bigint` arrives from `pg` as a string, as everywhere. Null until the
    // upload is confirmed, and for anything linked.
    bytes: row.bytes === null || row.state !== 'stored' ? null : Number(row.bytes),
    tabId: row.tabId,
  };
}

/**
 * The words this asset is filed under, alphabetical.
 *
 * Alphabetical rather than by when they were added: a row of chips is scanned,
 * and the order somebody happened to type them in is not an order anybody can
 * scan by.
 */
function selectTags(database: RequestContext['database'], assetId: string) {
  return database
    .selectFrom('assetTag')
    .select('tag')
    .where('assetId', '=', assetId)
    .orderBy('tag')
    .execute();
}

/**
 * The tabs this asset is worked in, each with its blocks and their items, and
 * the blocks of its Overview, which are the ones on no tab.
 *
 * Three statements for the three levels rather than a join across them: a join
 * would repeat each tab once per checklist line under it, and an asset with a
 * long animation list has far more lines than tabs. All three by position,
 * because the order is the pipeline somebody laid out.
 */
async function selectTabs(
  database: RequestContext['database'],
  assetId: string,
): Promise<{ tabs: AssetTab[]; overview: AssetTabBlock[] }> {
  const [tabs, blocks, items] = await Promise.all([
    selectTabRows(database, assetId),
    database
      .selectFrom('assetTabBlock')
      .select(['id', 'tabId', 'kind', 'body'])
      .where('assetId', '=', assetId)
      .orderBy('position')
      .execute(),
    database
      .selectFrom('assetTabChecklistItem')
      .select(['id', 'blockId', 'title', 'done'])
      .where('assetId', '=', assetId)
      .orderBy('position')
      .execute(),
  ]);

  const toBlock = (block: (typeof blocks)[number]): AssetTabBlock => ({
    id: block.id,
    kind: block.kind,
    body: block.body,
    items: items
      .filter((item) => item.blockId === block.id)
      .map((item) => ({ id: item.id, title: item.title, done: item.done })),
  });

  return {
    overview: blocks.filter((block) => block.tabId === null).map(toBlock),
    tabs: tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      done: tab.done,
      dueOn: tab.dueOn,
      assignee: personNamed({
        userId: tab.assigneeId,
        displayName: tab.assigneeName,
        initials: tab.assigneeInitials,
        avatarFileId: tab.assigneeAvatarFileId,
        avatarState: tab.assigneeAvatarState,
      }),
      blocks: blocks.filter((block) => block.tabId === tab.id).map(toBlock),
    })),
  };
}

/** The tabs themselves, with the person on each. */
function selectTabRows(database: RequestContext['database'], assetId: string) {
  return database
    .selectFrom('assetTab')
    .leftJoin('appUser as assignee', 'assignee.id', 'assetTab.assigneeId')
    .leftJoin('file as assigneeAvatar', 'assigneeAvatar.id', 'assignee.avatarFileId')
    .select([
      'assetTab.id',
      'assetTab.title',
      'assetTab.done',
      'assetTab.dueOn',
      'assetTab.assigneeId',
      'assignee.displayName as assigneeName',
      'assignee.initials as assigneeInitials',
      'assignee.avatarFileId as assigneeAvatarFileId',
      'assigneeAvatar.state as assigneeAvatarState',
    ])
    .where('assetTab.assetId', '=', assetId)
    .orderBy('assetTab.position')
    .execute();
}

/**
 * The cards about this asset, open ones first.
 *
 * A second statement rather than a join: joining would repeat every field of the
 * asset once per card, and this is the half somebody scrolls.
 */
function selectCards(database: RequestContext['database'], assetId: string) {
  return database
    .selectFrom('cardAssetLink')
    .innerJoin('card', 'card.id', 'cardAssetLink.cardId')
    .select(['cardAssetLink.id as linkId', 'card.id as cardId', 'card.cardKey', 'card.title'])
    .select((builder) => builder.eb('card.closedAt', 'is not', null).as('closed'))
    .where('cardAssetLink.assetId', '=', assetId)
    .orderBy('closed')
    .orderBy('card.cardKey')
    .execute();
}

/**
 * The other assets this one goes with, by name.
 *
 * A pair is stored once, lower id first, so this one may be either end of it:
 * the asset wanted is whichever end is not this one. By name rather than by
 * when they were linked, because a boss with fourteen drops is a list somebody
 * scans for the helm.
 */
function selectLinkedAssets(database: RequestContext['database'], assetId: string) {
  return database
    .selectFrom('assetLink')
    .innerJoin('asset', (join) =>
      join.on((builder) =>
        builder.or([
          builder('asset.id', '=', builder.ref('assetLink.firstAssetId')),
          builder('asset.id', '=', builder.ref('assetLink.secondAssetId')),
        ]),
      ),
    )
    .innerJoin('assetCategory', 'assetCategory.id', 'asset.categoryId')
    .select([
      'assetLink.id as linkId',
      'asset.id as assetId',
      'asset.assetKey',
      'asset.name',
      'asset.phase',
      'assetCategory.id as categoryId',
      'assetCategory.name as categoryName',
      'assetCategory.color as categoryColor',
    ])
    .where((builder) =>
      builder.or([
        builder('assetLink.firstAssetId', '=', assetId),
        builder('assetLink.secondAssetId', '=', assetId),
      ]),
    )
    .where('asset.id', '!=', assetId)
    .orderBy('asset.name')
    .execute();
}

function toLinkedAsset(row: Awaited<ReturnType<typeof selectLinkedAssets>>[number]): LinkedAsset {
  return {
    linkId: row.linkId,
    assetId: row.assetId,
    assetKey: row.assetKey,
    name: row.name,
    phase: row.phase,
    category: { id: row.categoryId, name: row.categoryName, color: row.categoryColor },
  };
}

type AssetRow = NonNullable<Awaited<ReturnType<typeof selectAsset>>>;

/**
 * Somebody named on the asset, as the panel draws a person.
 *
 * One function for both of them. Who is making a thing and who asked for it are
 * different questions about an asset and the same four fields about a person,
 * and a reporter drawn even slightly unlike an assignee would be a difference
 * nobody chose.
 *
 * Null when the row has nobody, and null again when a left join found nobody —
 * an id pointing at an account that has gone is the same absence to a panel as
 * an id that was never set.
 */
function personNamed(person: {
  readonly userId: string | null;
  readonly displayName: string | null;
  readonly initials: string | null;
  readonly avatarFileId: string | null;
  readonly avatarState: string | null;
}): CardAssignee | null {
  if (person.userId === null || person.displayName === null) {
    return null;
  }

  return {
    userId: person.userId,
    displayName: person.displayName,
    initials: person.initials ?? '',
    avatarUrl: pictureUrl(person.avatarFileId, person.avatarState),
  };
}

function toDetail(
  row: AssetRow,
): Omit<
  AssetDetailView,
  | 'canDelete'
  | 'canLink'
  | 'canManageTemplates'
  | 'cards'
  | 'files'
  | 'linkedAssets'
  | 'overview'
  | 'references'
  | 'tabs'
  | 'tags'
  | 'work'
> {
  return {
    id: row.id,
    assetKey: row.assetKey,
    name: row.name,
    phase: row.phase,
    description: row.description,
    // `bigint` arrives from `pg` as a string, as everywhere.
    estimatedCostMinor: row.estimatedCostMinor === null ? null : Number(row.estimatedCostMinor),
    dueOn: row.dueOn,
    assignee: personNamed({
      userId: row.assigneeId,
      displayName: row.assigneeName,
      initials: row.assigneeInitials,
      avatarFileId: row.assigneeAvatarFileId,
      avatarState: row.assigneeAvatarState,
    }),
    reporter: personNamed({
      userId: row.reporterId,
      displayName: row.reporterName,
      initials: row.reporterInitials,
      avatarFileId: row.reporterAvatarFileId,
      avatarState: row.reporterAvatarState,
    }),
    category: {
      id: row.categoryId,
      name: row.categoryName,
      color: row.categoryColor,
    },
    project: {
      id: row.projectId,
      slug: row.projectSlug,
      currency: row.projectCurrency,
      archived: row.projectArchivedAt !== null,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
