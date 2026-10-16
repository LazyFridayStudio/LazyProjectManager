import { sql } from '@lpm/database';
import { assetTemplatesQuery, type AssetTemplatesView } from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { requireActor } from '../../../cqrs/request-context.js';
import { ProjectNotFoundError } from '../../../domain/index.js';
import {
  assertProjectPermission,
  canReachProject,
  loadMembershipRole,
  mayDo,
} from '../../projects/project-access.js';
import { readDefinition } from '../asset-template-tabs.js';

/**
 * A project's templates, by name.
 *
 * Read by anybody who may read the library: the picker that offers them is on
 * the asset panel and the new-asset dialog, and choosing one is changing an
 * asset rather than keeping templates.
 */
export const assetTemplatesHandler = defineQueryHandler({
  definition: assetTemplatesQuery,

  async execute(params: { projectId: string }, context): Promise<AssetTemplatesView> {
    const actor = requireActor(context, assetTemplatesQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.view' });

    const project = await context.database
      .selectFrom('project')
      .select('project.id')
      .where('project.id', '=', params.projectId)
      .where('project.accountId', '=', actor.accountId)
      .where(canReachProject({ actor, role }))
      .executeTakeFirst();

    if (project === undefined) {
      throw new ProjectNotFoundError();
    }

    const templates = await context.database
      .selectFrom('assetTemplate')
      // As text, because the `CamelCasePlugin` renames keys inside `jsonb`.
      .select(['id', 'name', sql<string>`definition::text`.as('definition')])
      .where('projectId', '=', project.id)
      .orderBy('name')
      .execute();

    return {
      templates: templates.map((template) => ({
        id: template.id,
        name: template.name,
        definition: readDefinition(template.definition),
      })),
      canManage: mayDo({ actor, role, action: 'asset.manageTemplate' }),
    };
  },
});
