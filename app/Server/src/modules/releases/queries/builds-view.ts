import { sql, type Database } from '@lpm/database';
import {
  buildsQuery,
  releaseSourceSchema,
  type BuildsView,
  type Release,
  type ReleaseSync,
} from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { requireActor } from '../../../cqrs/request-context.js';
import { ProjectNotFoundError } from '../../../domain/index.js';
import {
  assertProjectPermission,
  loadMembershipRole,
  mayDo,
} from '../../projects/project-access.js';

/**
 * What a project has shipped: the latest release, and everything before it.
 *
 * The newest is answered separately from the rest because the page draws it as
 * a different thing — the headline gets its notes and its downloads, the others
 * get two lines each. Splitting it here rather than on the screen means there
 * is one definition of "latest" and it is the one the page shows.
 */
export const buildsHandler = defineQueryHandler({
  definition: buildsQuery,

  async execute(params: { slug: string }, context): Promise<BuildsView> {
    const actor = requireActor(context, buildsQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'release.view' });

    const project = await context.database
      .selectFrom('project')
      .select(['id', 'name', 'slug', 'code'])
      .where('slug', '=', params.slug)
      .where('accountId', '=', actor.accountId)
      .executeTakeFirst();

    if (project === undefined) {
      // Also what another account's project looks like, and one this actor was
      // never added to. Nobody learns a project exists by guessing at its slug.
      throw new ProjectNotFoundError();
    }

    const [latest, ...earlier] = await loadReleases(context.database, project.id);

    return {
      project,
      latest: latest ?? null,
      earlier,
      // Asked once here rather than worked out again on the screen, so the
      // button and the command behind it cannot disagree about who may write.
      canWrite: mayDo({ actor, role, action: 'release.view' }),
      sync: await loadSync(context.database, project.id),
    };
  },
});

/**
 * One download as `json_agg` hands it back.
 *
 * `sizeBytes` is a string here and a number on the way out: `bigint` does not
 * fit a JavaScript number, so `pg` gives it as text and every read of one in
 * this codebase converts it deliberately rather than by accident.
 */
interface AssetRow {
  id: string;
  name: string;
  sizeBytes: string | null;
  downloadCount: number;
  downloadUrl: string | null;
}

interface ReleaseRow {
  id: string;
  source: string;
  tag: string;
  name: string;
  publishedOn: string;
  author: string;
  commitSha: string | null;
  isPrerelease: boolean;
  isDraft: boolean;
  notes: string;
  runLabel: string | null;
  url: string | null;
  assets: AssetRow[] | null;
}

/**
 * Every release, newest first, each carrying its own downloads.
 *
 * One statement with the assets gathered in a lateral join rather than a second
 * query per release, which is the rule this codebase holds itself to: a page
 * that reads ten releases must not be ten round trips plus one.
 *
 * `published_on` orders it and `created_at` breaks the tie, because two
 * releases cut on the same day is normal and a page whose order changes between
 * loads is one nobody trusts.
 */
async function loadReleases(database: Database, projectId: string): Promise<Release[]> {
  const rows = await database
    .selectFrom('projectRelease')
    .select([
      'id',
      'source',
      'tag',
      'name',
      'publishedOn',
      'author',
      'commitSha',
      'isPrerelease',
      'isDraft',
      'notes',
      'runLabel',
      'url',
    ])
    .select(
      sql<AssetRow[] | null>`(
        select json_agg(
          json_build_object(
            'id', asset.id,
            'name', asset.name,
            'sizeBytes', asset.size_bytes::bigint,
            'downloadCount', asset.download_count,
            'downloadUrl', asset.download_url
          )
          order by asset.position, asset.created_at
        )
        from release_asset as asset
        where asset.release_id = project_release.id
      )`.as('assets'),
    )
    .where('projectId', '=', projectId)
    .orderBy('publishedOn', 'desc')
    .orderBy('createdAt', 'desc')
    .execute();

  return rows.map((row: ReleaseRow) => ({
    ...row,
    /*
     * A source the schema does not recognise reads as `hand`.
     *
     * The column is text so a provider can be added without a migration, which
     * means a row could hold a word this build has never heard of. Treating one
     * as hand-entered is the safe way round: the worst it does is refuse to let
     * a sync overwrite something, and the alternative is a page that fails to
     * draw because of a string in a column.
     */
    source: releaseSourceSchema.catch('hand').parse(row.source),
    // `json_agg` over nothing is null, and a release with no downloads has an
    // empty list rather than a missing one.
    assets: (row.assets ?? []).map((asset) => ({
      ...asset,
      sizeBytes: asset.sizeBytes === null ? null : Number(asset.sizeBytes),
    })),
  }));
}

/**
 * The repository this page can fill itself from.
 *
 * `canRead` is separate from having a connection at all, because a project can
 * be wired up for webhooks and still have no credential to read with — which is
 * the state every Gitea and GitLab connection is in today. A `Re-sync` button
 * that fails on press is worse than one that says why it cannot.
 */
async function loadSync(database: Database, projectId: string): Promise<ReleaseSync | null> {
  const connection = await database
    .selectFrom('scmConnection')
    .select([
      'provider',
      'repoFullName',
      'appId',
      'installationId',
      'privateKeyEnc',
      'releasesSyncedAt',
    ])
    .where('projectId', '=', projectId)
    .executeTakeFirst();

  if (connection === undefined) {
    return null;
  }

  return {
    provider: connection.provider,
    repoFullName: connection.repoFullName,
    canRead:
      connection.appId !== null &&
      connection.installationId !== null &&
      connection.privateKeyEnc !== null,
    syncedAt: connection.releasesSyncedAt?.toISOString() ?? null,
  };
}
