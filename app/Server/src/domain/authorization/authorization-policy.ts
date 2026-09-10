import { ForbiddenError } from '../errors/domain-error.js';
import { isAtLeastLevel, type AccessLevel } from './access-levels.js';
import { hasAtLeastRole, isOutsourcer, isOwner, type MembershipRole } from './membership-roles.js';
import { decide, type PermissionRule } from './permission-rules.js';
import {
  isActionAvailableToOutsourcers,
  minimumLevelByAction,
  minimumRoleByAction,
  type PermittedAction,
} from './permitted-actions.js';

export interface AuthorizationActor {
  readonly userId: string;
  readonly accountId: string;
  readonly role: MembershipRole;
  /** Cards shared with this actor. Only consulted for outsourcers. */
  readonly sharedCardIds?: readonly string[];
  /**
   * Every rule reaching this person, gathered through the teams they are in.
   *
   * Optional, and absent means the same as empty: an install with no permission
   * groups behaves exactly as it did before they existed.
   */
  readonly rules?: readonly PermissionRule[];
}

export interface AuthorizationResource {
  /** The account the resource belongs to. Cross-account access is never allowed. */
  readonly accountId: string;
  /** Present when the action targets a specific card. */
  readonly cardId?: string;
  /**
   * How much of the project this resource is in the actor reaches.
   *
   * Left out for anything that is not in a project — the install's settings,
   * its people, its teams — and for the callers that have already checked it
   * themselves while loading the thing.
   */
  readonly projectLevel?: AccessLevel;
}

export interface AuthorizationRequest {
  readonly actor: AuthorizationActor;
  readonly action: PermittedAction;
  readonly resource: AuthorizationResource;
}

/**
 * Answers whether an actor may perform an action on a resource.
 *
 * Called at the top of every command handler and every query. This function
 * answers and never mutates — use `assertCan` when the caller wants the attempt
 * to fail rather than branch.
 */
export function can(request: AuthorizationRequest): boolean {
  if (!belongsToSameAccount(request.actor, request.resource)) {
    return false;
  }

  const verdict = decide(request.actor.rules ?? [], request.action);

  /*
   * A denial applies to everybody except an owner. An outsourcer included.
   *
   * Narrowing is otherwise always safe to apply: the worst a wrong `deny` does
   * is refuse somebody who should have been allowed, and they say so. The order
   * matters — checked before the outsourcer branch, so a rule cannot be escaped
   * by being on the other ladder.
   *
   * **An owner is the person who decides what the groups say, so a group cannot
   * narrow them.** Without this, one deny on `team.manage` given to a team the
   * owners are in takes away the only way to undo it: the screen that edits the
   * rule is behind the rule. There is no support line to ring on a self-hosted
   * install, and the fix is a hand on a psql prompt.
   *
   * It costs nothing that was worth having. Every action's minimum role is at
   * most `owner`, so an owner passes all of them on rank anyway — a deny was
   * the only thing that could ever have refused one, and refusing one is the
   * failure this exists to prevent.
   */
  if (verdict === 'deny' && !isOwner(request.actor.role)) {
    return false;
  }

  if (isOutsourcer(request.actor.role)) {
    // An `allow` deliberately does not widen an outsourcer. Their access comes
    // from the share list and nothing else, which is the wall that stops a
    // future "outsourcers count as members" shortcut.
    return isOutsourcerAllowed(request);
  }

  /*
   * An `allow` stands in for the role, and only for the role.
   *
   * It is what lets a member be given `board.manageList` without being made a
   * lead. It does not stand in for reaching the project: a group says what
   * somebody may do, and `team_grant` says where — being allowed to move cards
   * is not being allowed to move them on a board you cannot see.
   */
  if (verdict === 'allow') {
    return reachesFarEnough(request);
  }

  return (
    hasAtLeastRole(request.actor.role, minimumRoleByAction[request.action]) &&
    reachesFarEnough(request)
  );
}

/**
 * Whether the actor reaches enough of the project to do this here.
 *
 * A role that allows an action allows it in the projects the person can reach,
 * and nowhere else. When no level was given there is no project in the
 * question, so there is nothing to be short of.
 */
function reachesFarEnough(request: AuthorizationRequest): boolean {
  const level = request.resource.projectLevel;

  return level === undefined || isAtLeastLevel(level, minimumLevelByAction[request.action]);
}

/**
 * Performs the permission check and throws `ForbiddenError` when it fails.
 *
 * Prefer this at the top of a handler: it keeps the rest of the function on the
 * happy path instead of nesting the real work inside a permission branch.
 */
export function assertCan(request: AuthorizationRequest): void {
  if (can(request)) {
    return;
  }

  throw new ForbiddenError(`Not permitted to ${request.action}.`);
}

function belongsToSameAccount(actor: AuthorizationActor, resource: AuthorizationResource): boolean {
  return actor.accountId === resource.accountId;
}

/**
 * An outsourcer's access is decided entirely by the share list. They may act
 * only on a named card, and only on one that has been shared with them, so an
 * action without a `cardId` — anything board- or project-wide — is always denied.
 */
function isOutsourcerAllowed(request: AuthorizationRequest): boolean {
  if (!isActionAvailableToOutsourcers(request.action)) {
    return false;
  }

  const targetCardId = request.resource.cardId;

  if (targetCardId === undefined) {
    return false;
  }

  return (request.actor.sharedCardIds ?? []).includes(targetCardId);
}
