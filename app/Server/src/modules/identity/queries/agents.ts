import { sql } from '@lpm/database';
import { agentsQuery, type Agent, type AgentsView } from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { requireActor, type RequestContext } from '../../../cqrs/request-context.js';
import { pictureUrl } from '../../files/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';

/**
 * Every agent on the install, and the keys each of them has.
 *
 * Never the secrets. There are none to return — only a hash is stored — and
 * this is the list a person reads to decide whether a key still matters: what
 * it is called, when it was made, and when something last presented it.
 */
export const agentsHandler = defineQueryHandler({
  definition: agentsQuery,

  async execute(_params: Record<string, never>, context): Promise<AgentsView> {
    const actor = requireActor(context, agentsQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'agent.view' });

    const agents = await selectAgents(context, actor.accountId);
    const tokens = await selectTokens(context, actor.accountId);

    return {
      agents: agents.map((agent): Agent => ({
        userId: agent.userId,
        displayName: agent.displayName,
        initials: agent.initials,
        avatarUrl: pictureUrl(agent.avatarFileId, agent.avatarState),
        permissionGroups: readGroups(agent.groups),
        tokens: tokens
          .filter((token) => token.userId === agent.userId)
          .map((token) => ({
            id: token.id,
            name: token.name,
            createdAt: token.createdAt.toISOString(),
            lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
            revokedAt: token.revokedAt?.toISOString() ?? null,
          })),
      })),
    };
  },
});

function selectAgents(context: RequestContext, accountId: string) {
  return context.database
    .selectFrom('appUser')
    .innerJoin('membership', 'membership.userId', 'appUser.id')
    .leftJoin('file as avatar', 'avatar.id', 'appUser.avatarFileId')
    .select((builder) => [
      'appUser.id as userId',
      'appUser.displayName as displayName',
      'appUser.initials as initials',
      'appUser.avatarFileId as avatarFileId',
      'avatar.state as avatarState',
      // What it may do, which is the whole of what it may do. The same shape a
      // person's groups come back in, because the same dialog switches them —
      // and null when it holds none, which `readGroups` reads as an empty list.
      builder
        .selectFrom('userPermissionGroup')
        .innerJoin('permissionGroup', 'permissionGroup.id', 'userPermissionGroup.groupId')
        .select(
          sql<
            GroupRow[] | null
          >`json_agg(json_build_object('groupId', permission_group.id, 'name', permission_group.name) order by permission_group.name)`.as(
            'groups',
          ),
        )
        .whereRef('userPermissionGroup.userId', '=', 'appUser.id')
        .as('groups'),
    ])
    .where('membership.accountId', '=', accountId)
    .where('appUser.kind', '=', 'agent')
    .orderBy('appUser.displayName')
    .execute();
}

/**
 * Every key, revoked ones included.
 *
 * A revoked key stays listed as revoked: one that vanished would leave somebody
 * wondering whether they had revoked it or imagined it.
 */
function selectTokens(context: RequestContext, accountId: string) {
  return context.database
    .selectFrom('apiToken')
    .innerJoin('appUser', 'appUser.id', 'apiToken.userId')
    .innerJoin('membership', 'membership.userId', 'appUser.id')
    .select([
      'apiToken.id as id',
      'apiToken.userId as userId',
      'apiToken.name as name',
      'apiToken.createdAt as createdAt',
      'apiToken.lastUsedAt as lastUsedAt',
      'apiToken.revokedAt as revokedAt',
    ])
    .where('membership.accountId', '=', accountId)
    .orderBy('apiToken.createdAt', 'desc')
    .execute();
}

interface GroupRow {
  groupId: string;
  name: string;
}

/** `json_agg` returns null for a person holding none, which reads as an empty list. */
function readGroups(groups: GroupRow[] | null): GroupRow[] {
  return groups ?? [];
}
