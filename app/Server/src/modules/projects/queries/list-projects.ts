import { projectListQuery, type ProjectListView, type ProjectScope } from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { requireActor } from '../../../cqrs/request-context.js';
import { assertProjectPermission, loadMembershipRole } from '../project-access.js';
import { selectProjectSummaries, toProjectSummary } from './project-summary-reader.js';

/**
 * The launcher.
 *
 * An outsourcer is refused here rather than served an empty list: their access
 * is decided card by card from the share list, so a project-wide question has no
 * answer for them.
 */
export const listProjectsHandler = defineQueryHandler({
  definition: projectListQuery,

  async execute(params: { scope: ProjectScope }, context): Promise<ProjectListView> {
    const actor = requireActor(context, projectListQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'project.view' });

    const rows = await selectProjectSummaries(
      { database: context.database, actor, role },
      params.scope,
    ).execute();

    return { projects: rows.map((row) => toProjectSummary(row, role)) };
  },
});
