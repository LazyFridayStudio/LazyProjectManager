import type { AccessLevel } from './access-levels.js';
import type { MembershipRole } from './membership-roles.js';

/**
 * Every action the authorisation policy can be asked about.
 *
 * Named `resource.verb` so a call site reads as the thing being attempted:
 * `can({ actor, action: 'card.move', resource })`.
 *
 * **One action per thing somebody does.** There were nineteen of these, and
 * `card.update` guarded twenty-five handlers — editing a card, yes, but also
 * rewriting the design document, retagging an asset and detaching a file. So
 * "may fix the wording on a card" and "may delete the design document" were one
 * permission, and a studio wanting to say one without the other could not.
 *
 * The rule for adding one: if somebody could plausibly want it answered
 * differently from its neighbour, it is its own action. Splitting costs a row on
 * a screen that collapses; not splitting costs a sentence nobody can say.
 */
export const permittedActions = [
  'project.view',
  'project.create',
  'project.update',
  'project.archive',
  'member.invite',
  'member.remove',
  'scm.connect',
  'board.viewList',
  'board.manageList',
  'card.view',
  'card.create',
  'card.update',
  'card.delete',
  'card.move',
  'card.comment',
  'card.link',
  'asset.view',
  'asset.create',
  'asset.update',
  'asset.delete',
  'asset.manageCategory',
  'file.upload',
  'file.remove',
  'doc.view',
  'doc.create',
  'doc.update',
  'doc.delete',
  'milestone.view',
  'milestone.manage',
  'timeline.view',
  'budget.view',
  'dashboard.view',
  'release.view',
  'release.record',
  'user.view',
  'user.manage',
  'team.view',
  'team.manage',
  'settings.manage',
  'audit.view',
  'recovery.view',
  'recovery.restore',
  'recovery.purge',
  'agent.view',
  'agent.create',
  'agent.update',
  'agent.issueKey',
  'agent.revokeKey',
] as const;

export type PermittedAction = (typeof permittedActions)[number];

/**
 * The minimum role each action requires, for every role except `outsourcer`.
 *
 * An outsourcer is not on this ladder at all; `authorization-policy` decides
 * their access from the share list instead. Keeping the two rules apart is what
 * stops a future "outsourcers count as members" shortcut from quietly widening
 * their view of the board.
 *
 * Every action split out of another inherited the role of the one it came from,
 * so widening the vocabulary changed nobody's access on the day it landed.
 */
export const minimumRoleByAction: Readonly<Record<PermittedAction, MembershipRole>> = {
  'project.view': 'viewer',
  'project.create': 'lead',
  'project.update': 'lead',
  'project.archive': 'owner',
  'member.invite': 'lead',
  'member.remove': 'owner',
  'scm.connect': 'owner',
  'board.viewList': 'viewer',
  'board.manageList': 'lead',
  'card.view': 'viewer',
  'card.create': 'member',
  'card.update': 'member',
  'card.delete': 'member',
  'card.move': 'member',
  'card.comment': 'member',
  'card.link': 'member',
  'asset.view': 'viewer',
  'asset.create': 'member',
  'asset.update': 'member',
  'asset.delete': 'member',
  'asset.manageCategory': 'lead',
  'file.upload': 'member',
  'file.remove': 'member',
  'doc.view': 'viewer',
  'doc.create': 'member',
  'doc.update': 'member',
  'doc.delete': 'member',
  'milestone.view': 'viewer',
  'milestone.manage': 'lead',
  'timeline.view': 'viewer',
  'budget.view': 'viewer',
  'dashboard.view': 'viewer',
  'release.view': 'viewer',
  'release.record': 'lead',
  'user.view': 'owner',
  'user.manage': 'owner',
  'team.view': 'owner',
  'team.manage': 'owner',
  'settings.manage': 'owner',
  'audit.view': 'owner',
  'agent.view': 'owner',
  'agent.create': 'owner',
  'agent.update': 'owner',
  'agent.issueKey': 'owner',
  'agent.revokeKey': 'owner',
  'recovery.view': 'owner',
  'recovery.restore': 'owner',
  'recovery.purge': 'owner',
};

/**
 * The only actions an outsourcer may perform, and then only on a card that has
 * been explicitly shared with them.
 */
const outsourcerActions = new Set<PermittedAction>(['card.view', 'card.comment', 'card.update']);

export function isActionAvailableToOutsourcers(action: PermittedAction): boolean {
  return outsourcerActions.has(action);
}

/**
 * How much of the project each action needs.
 *
 * The other half of a permission, and a different question from the role: the
 * role says whether somebody writes cards at all, and this says whether they may
 * write one *here*. `none` marks the actions that are not about a project — the
 * install's own settings, its people, its teams — where there is nothing to be
 * shut out of.
 */
export const minimumLevelByAction: Readonly<Record<PermittedAction, AccessLevel>> = {
  'project.view': 'read',
  'project.create': 'none',
  'project.update': 'write',
  'project.archive': 'write',
  'member.invite': 'write',
  'member.remove': 'write',
  'scm.connect': 'write',
  'board.viewList': 'read',
  'board.manageList': 'write',
  'card.view': 'read',
  'card.create': 'write',
  'card.update': 'write',
  'card.delete': 'write',
  'card.move': 'write',
  'card.comment': 'write',
  'card.link': 'write',
  'asset.view': 'read',
  'asset.create': 'write',
  'asset.update': 'write',
  'asset.delete': 'write',
  'asset.manageCategory': 'write',
  'file.upload': 'write',
  'file.remove': 'write',
  'doc.view': 'read',
  'doc.create': 'write',
  'doc.update': 'write',
  'doc.delete': 'write',
  'milestone.view': 'read',
  'milestone.manage': 'write',
  'timeline.view': 'read',
  'budget.view': 'read',
  'dashboard.view': 'read',
  'release.view': 'read',
  'release.record': 'write',
  'agent.view': 'none',
  'agent.create': 'none',
  'agent.update': 'none',
  'agent.issueKey': 'none',
  'agent.revokeKey': 'none',
  'user.view': 'none',
  'user.manage': 'none',
  'team.view': 'none',
  'team.manage': 'none',
  'settings.manage': 'none',
  'audit.view': 'none',
  'recovery.view': 'none',
  'recovery.restore': 'none',
  'recovery.purge': 'none',
};
