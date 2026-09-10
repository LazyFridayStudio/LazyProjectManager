import { countWords, designDocQuery, type DesignDocView } from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import type { RequestContext } from '../../../cqrs/request-context.js';
import { requireActor } from '../../../cqrs/request-context.js';
import { ProjectNotFoundError } from '../../../domain/index.js';
import {
  assertProjectPermission,
  loadMembershipRole,
  mayDo,
} from '../../projects/project-access.js';

/**
 * A project's documents, and the one being read.
 *
 * The tabs and the document come back together because they are on the same
 * screen: two queries would mean a page that can draw a tab strip with no
 * document under it, or a document under a strip that has not arrived.
 *
 * Every document is read whole. They are text — even a long one is smaller than
 * a single screenshot in it, and a document delivered a piece at a time is one
 * the browser cannot search.
 */
export const designDocHandler = defineQueryHandler({
  definition: designDocQuery,

  async execute(params: { slug: string; docId?: string }, context): Promise<DesignDocView> {
    const actor = requireActor(context, designDocQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'doc.view' });

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

    const documents = await loadDocuments(context, project.id);

    // The one asked for, or the first — which is what following a link to the
    // design doc should show. A `docId` that is not in this project falls back
    // rather than erroring: a stale tab is not a mistake worth a page of red.
    const open = documents.find((document) => document.id === params.docId) ?? documents[0] ?? null;

    return {
      project,
      documents: documents.map((document) => ({
        id: document.id,
        title: document.title,
        wordCount: countWords(document.body),
      })),
      document:
        open === null
          ? null
          : {
              id: open.id,
              title: open.title,
              body: open.body,
              wordCount: countWords(open.body),
              updatedAt: open.updatedAt.toISOString(),
              updatedBy: open.updatedBy,
            },
      // Asked once here rather than worked out again on the screen, so the Edit
      // button and the command behind it cannot disagree about who may write.
      canWrite: mayDo({ actor, role, action: 'doc.view' }),
    };
  },
});

interface StoredDocument {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly updatedAt: Date;
  readonly updatedBy: string | null;
}

/**
 * Every document the project keeps, in the order of the tabs.
 *
 * The writer's name is joined on rather than fetched after, and joined loosely:
 * a document whose author has since left keeps its prose and loses only the
 * name, which is the right way round.
 */
async function loadDocuments(
  context: RequestContext,
  projectId: string,
): Promise<StoredDocument[]> {
  return context.database
    .selectFrom('projectDoc')
    .leftJoin('appUser', 'appUser.id', 'projectDoc.updatedBy')
    .select([
      'projectDoc.id as id',
      'projectDoc.title as title',
      'projectDoc.body as body',
      'projectDoc.updatedAt as updatedAt',
      'appUser.displayName as updatedBy',
    ])
    .where('projectDoc.projectId', '=', projectId)
    .orderBy('projectDoc.position')
    .orderBy('projectDoc.createdAt')
    .execute();
}
