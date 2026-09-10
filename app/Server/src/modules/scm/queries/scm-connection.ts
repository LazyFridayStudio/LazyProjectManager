import { scmConnectionQuery, type ScmConnection } from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import type { RequestContext } from '../../../cqrs/request-context.js';
import { requireActor } from '../../../cqrs/request-context.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { buildWebhookUrl } from '../webhook/webhook-url.js';

/**
 * The repository a project is connected to, and how its webhook is doing.
 *
 * Null rather than a failure when there is none: "this project has no
 * repository" is a normal answer to a settings screen asking, and the screen
 * needs it to know which form to draw.
 *
 * The secret is not returned, here or anywhere. It was shown once, where it was
 * generated; a screen that could show it again would be a way to read it out of
 * any project you can open.
 */
export const scmConnectionHandler = defineQueryHandler({
  definition: scmConnectionQuery,

  async execute(
    params: { projectId: string },
    context,
  ): Promise<{ connection: ScmConnection | null }> {
    const actor = requireActor(context, scmConnectionQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'project.view' });

    const row = await context.database
      .selectFrom('scmConnection')
      .innerJoin('project', 'project.id', 'scmConnection.projectId')
      .select([
        'scmConnection.id',
        'scmConnection.provider',
        'scmConnection.repoFullName',
        'scmConnection.endpoint',
        'scmConnection.connectedAt',
        'scmConnection.lastEventAt',
        'scmConnection.appId',
        'scmConnection.installationId',
        'scmConnection.accessCheckedAt',
        'scmConnection.syncFailedAt',
        'scmConnection.syncFailure',
      ])
      .where('scmConnection.projectId', '=', params.projectId)
      .where('scmConnection.accountId', '=', actor.accountId)
      .executeTakeFirst();

    if (row === undefined) {
      return { connection: null };
    }

    return {
      connection: {
        provider: row.provider,
        repoFullName: row.repoFullName,
        endpoint: row.endpoint,
        webhookUrl: buildWebhookUrl(context.environment.BASE_URL, row.id),
        connectedAt: row.connectedAt.toISOString(),
        lastEventAt: row.lastEventAt?.toISOString() ?? null,
        eventsReceived: await countDeliveries(context, row.id),
        // All three columns move together — the database holds that — so one
        // being set is enough to know reading is configured.
        appAccess:
          row.appId === null || row.installationId === null
            ? null
            : {
                appId: row.appId,
                installationId: row.installationId,
                checkedAt: row.accessCheckedAt?.toISOString() ?? null,
              },
        // Both columns move together — a failure is recorded with its reason
        // and cleared with it — so either being set is enough to know there is
        // something to say.
        lastSyncFailure:
          row.syncFailedAt === null || row.syncFailure === null
            ? null
            : { at: row.syncFailedAt.toISOString(), reason: row.syncFailure },
      },
    };
  },
});

/**
 * How many deliveries have landed.
 *
 * Shown because the useful question about a webhook is not "is it configured"
 * but "has anything ever arrived" — and a zero next to a connection made an hour
 * ago is the answer to why nothing is appearing on the cards.
 */
async function countDeliveries(context: RequestContext, connectionId: string): Promise<number> {
  const counted = await context.database
    .selectFrom('scmEventRaw')
    .select((builder) => builder.fn.countAll<string>().as('total'))
    .where('connectionId', '=', connectionId)
    .executeTakeFirst();

  return Number(counted?.total ?? 0);
}
