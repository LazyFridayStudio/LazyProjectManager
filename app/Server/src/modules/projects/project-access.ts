import { sql, type Database, type DatabaseTransaction, type RawBuilder } from '@lpm/database';

import {
  requireActor,
  type RequestActor,
  type RequestContext,
} from '../../cqrs/request-context.js';
import {
  assertCan,
  can,
  hasAtLeastRole,
  ProjectNotFoundError,
  type AccessLevel,
  type AuthorizationRequest,
  type MembershipRole,
  type PermittedAction,
} from '../../domain/index.js';

/**
 * The role an actor holds in their account.
 *
 * Read on every project request rather than carried on the session, so a role
 * that is taken away stops applying at the next request instead of whenever the
 * user next signs in.
 */
export async function loadMembershipRole(
  database: Database,
  actor: RequestActor,
): Promise<MembershipRole> {
  const membership = await database
    .selectFrom('membership')
    .select('role')
    .where('userId', '=', actor.userId)
    .where('accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (membership === undefined) {
    // The session names an account this user is no longer part of. Nothing in it
    // is theirs to see, so this reads as "no such project" rather than as an
    // error that would confirm the account exists.
    throw new ProjectNotFoundError();
  }

  return membership.role;
}

/**
 * Whether a role sees every project in the account without being added to each
 * one.
 *
 * Anyone below this has to be a project member, which is what stops a viewer
 * brought in for one title from browsing the rest of the slate.
 */
export function seesEveryProject(role: MembershipRole): boolean {
  return hasAtLeastRole(role, 'lead');
}

/** Who is asking, and with what authority, wherever a project is in question. */
export interface ProjectReach {
  readonly actor: RequestActor;
  readonly role: MembershipRole;
}

/**
 * How much of a project somebody reaches, as a number the database can compare.
 *
 * The one place the rule lives, because it has to run inside the statements
 * that list projects — the launcher cannot fetch a thousand of them to find out
 * which six it may draw. Written to be dropped into any statement that has the
 * project table in scope as `project`.
 *
 * Three sources, and the most generous wins:
 *
 * - **The role.** An owner administers the install and a lead makes the
 *   projects, so both reach all of them. Everybody else starts at nothing.
 * - **Being on the project.** A viewer on a project reads it, anybody else on
 *   it writes.
 * - **Being in a team that is on the project.** A standing grant: the reach
 *   follows team membership, so joining the team joins its projects and
 *   leaving takes them away again.
 *
 * The third one carries no level of its own, and that is the point of it. A
 * team already holds permission groups, which say what its people may do; being
 * on a project says where they may do it. A level on the team's row would be a
 * third opinion about a question those two already answer between them — which
 * is exactly the shape #144 and `0035-no-team-grants` took out.
 */
export function reachedLevel(request: ProjectReach): RawBuilder<number> {
  const { actor } = request;
  const byRole = seesEveryProject(request.role) ? 2 : 0;

  return sql<number>`greatest(
    ${byRole},
    coalesce((
      select case project_member.role when 'viewer' then 1 else 2 end
      from project_member
      where project_member.project_id = project.id
        and project_member.user_id = ${actor.userId}
    ), 0),
    case when exists (
      select 1
      from project_team
        join team_member on team_member.team_id = project_team.team_id
      where project_team.project_id = project.id
        and team_member.user_id = ${actor.userId}
    ) then 2 else 0 end
  )`;
}

/**
 * Whether the actor reaches the project in scope at all.
 *
 * What every list of projects filters by, and what makes a project somebody
 * cannot reach indistinguishable from one that does not exist.
 */
export function canReachProject(request: ProjectReach): RawBuilder<boolean> {
  return sql<boolean>`${reachedLevel(request)} >= 1`;
}

/** Turns the number the database compares back into the word the policy uses. */
export function toAccessLevel(reached: number): AccessLevel {
  if (reached >= 2) return 'write';

  return reached >= 1 ? 'read' : 'none';
}

/**
 * How much of one named project the actor reaches.
 *
 * One statement, and the same expression the lists filter by, so a project
 * somebody can open is one they can act on to exactly the extent the launcher
 * implied.
 */
export async function loadProjectLevel(
  database: Database | DatabaseTransaction,
  request: ProjectReach,
  projectId: string,
): Promise<AccessLevel> {
  const found = await database
    .selectFrom('project')
    .select(reachedLevel(request).as('reached'))
    .where('project.id', '=', projectId)
    .where('project.accountId', '=', request.actor.accountId)
    .executeTakeFirst();

  return found === undefined ? 'none' : toAccessLevel(found.reached);
}

export interface ProjectPermissionRequest {
  readonly actor: RequestActor;
  readonly role: MembershipRole;
  readonly action: PermittedAction;
  /**
   * How much of the project in question the actor reaches.
   *
   * Left out where there is no project in the question — the install's people,
   * its teams, its settings — and by the callers that have already checked it
   * while loading the thing they are about to change. Supplied, it is the other
   * half of the permission: an `allow` on `card.move` says somebody moves
   * cards, and this says whether they may move one *here*.
   */
  readonly projectLevel?: AccessLevel;
}

/** Fails unless the actor may perform this action within their own account. */
export function assertProjectPermission(request: ProjectPermissionRequest): void {
  assertCan(toAuthorizationRequest(request));
}

/**
 * Whether the actor may perform an action, without refusing if they may not.
 *
 * For a view that has to say what somebody can do rather than do it: the design
 * doc offers Edit only to a reader who may write, and asking here means the
 * button and the command behind it cannot disagree about who that is.
 */
export function mayDo(request: ProjectPermissionRequest): boolean {
  return can(toAuthorizationRequest(request));
}

/** The one shape both of the above ask the policy in. */
function toAuthorizationRequest(request: ProjectPermissionRequest): AuthorizationRequest {
  return {
    actor: {
      userId: request.actor.userId,
      accountId: request.actor.accountId,
      role: request.role,
      rules: request.actor.rules,
    },
    action: request.action,
    resource: {
      accountId: request.actor.accountId,
      ...(request.projectLevel === undefined ? {} : { projectLevel: request.projectLevel }),
    },
  };
}

export interface WithinProjectRequest {
  readonly context: RequestContext;
  /** The command or query being answered, for the message if there is no actor. */
  readonly handlerName: string;
  readonly projectId: string;
  readonly action: PermittedAction;
}

/**
 * Whether the caller may do this, to this project.
 *
 * Two questions, and both have to be answered. The permission says whether this
 * person does the thing at all; the level says whether they may do it *here*.
 * `assertProjectPermission` on its own answers only the first, which is right
 * for the install's own screens and not enough for anything inside a project —
 * a group allowing `member.invite` without the second half would let somebody
 * add themselves to every project on the install.
 *
 * A project the actor does not reach is not found rather than forbidden. Being
 * refused about a project is how somebody learns that it exists.
 */
export async function authoriseWithinProject(request: WithinProjectRequest): Promise<RequestActor> {
  const { context, handlerName, projectId, action } = request;
  const actor = requireActor(context, handlerName);
  const role = await loadMembershipRole(context.database, actor);
  const projectLevel = await loadProjectLevel(context.database, { actor, role }, projectId);

  if (projectLevel === 'none') {
    throw new ProjectNotFoundError();
  }

  assertProjectPermission({ actor, role, action, projectLevel });

  return actor;
}

export interface WritableProject {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly slug: string;
  readonly startsOn: string | null;
  readonly shipsOn: string | null;
  readonly archivedAt: Date | null;
}

/**
 * Loads a project that is about to be changed, inside the caller's transaction.
 *
 * Scoped to the actor's account, so a project id guessed from another install is
 * indistinguishable from one that does not exist.
 */
export async function loadProjectForWrite(
  database: DatabaseTransaction,
  actor: RequestActor,
  projectId: string,
): Promise<WritableProject> {
  const project = await database
    .selectFrom('project')
    .select(['id', 'name', 'code', 'slug', 'startsOn', 'shipsOn', 'archivedAt'])
    .where('id', '=', projectId)
    .where('accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (project === undefined) {
    throw new ProjectNotFoundError();
  }

  return project;
}
