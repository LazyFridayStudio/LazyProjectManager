import type { Database } from '@lpm/database';
import { permissionsQuery, type PermissionEffect, type PermissionsView } from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { CATALOGUES, catalogues, describeRule } from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';

/**
 * Every permission group, what each says, and who holds it.
 *
 * Three statements rather than one join: a group joined to its rules and its
 * teams multiplies one by the other, and this screen is opened rarely enough
 * that three trips is cheaper than the arithmetic to undo that.
 */
export const permissionsHandler = defineQueryHandler({
  definition: permissionsQuery,

  async execute(_params: Record<string, never>, context): Promise<PermissionsView> {
    const actor = requireActor(context, permissionsQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'team.view' });

    const [groups, teams] = await Promise.all([
      loadGroups(context.database, actor),
      loadTeams(context.database, actor),
    ]);

    return { groups, teams, catalogues: describeCatalogues() };
  },
});

interface RuleRow {
  groupId: string;
  action: string;
  effect: string;
}

interface HolderRow {
  groupId: string;
  teamId: string;
  teamName: string;
  position: number;
}

async function loadGroups(
  database: Database,
  actor: RequestActor,
): Promise<PermissionsView['groups']> {
  const [groups, rules, holders] = await Promise.all([
    database
      .selectFrom('permissionGroup')
      .select(['id', 'name'])
      .where('accountId', '=', actor.accountId)
      .orderBy('name')
      .execute(),
    database
      .selectFrom('permissionRule')
      .select(['groupId', 'action', 'effect'])
      .where('accountId', '=', actor.accountId)
      .execute(),
    database
      .selectFrom('teamPermissionGroup')
      .innerJoin('team', 'team.id', 'teamPermissionGroup.teamId')
      .select([
        'teamPermissionGroup.groupId as groupId',
        'team.id as teamId',
        'team.name as teamName',
        'teamPermissionGroup.position as position',
      ])
      .where('teamPermissionGroup.accountId', '=', actor.accountId)
      .orderBy('team.name')
      .execute(),
  ]);

  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    rules: rules.filter((rule: RuleRow) => rule.groupId === group.id).flatMap(toRule),
    teams: holders
      .filter((holder: HolderRow) => holder.groupId === group.id)
      .map((holder) => ({
        id: holder.teamId,
        name: holder.teamName,
        // Where this group sits in *that* team's list. The same group is in a
        // different place in each team that holds it, so the number belongs to
        // the holding rather than to the group.
        position: holder.position,
      })),
  }));
}

/**
 * A stored effect this build does not recognise is dropped, not guessed at.
 *
 * The column has a check constraint so it cannot happen today. The safe way to
 * read a permission is still to ignore what you do not understand: a rule
 * nobody can interpret should reach nobody rather than reach everybody.
 */
function toRule(row: RuleRow): { subject: string; effect: PermissionEffect }[] {
  return row.effect === 'allow' || row.effect === 'deny'
    ? [{ subject: row.action, effect: row.effect }]
    : [];
}

async function loadTeams(
  database: Database,
  actor: RequestActor,
): Promise<PermissionsView['teams']> {
  return database
    .selectFrom('team')
    .select(['id', 'name'])
    .where('accountId', '=', actor.accountId)
    .orderBy('name')
    .execute();
}

/**
 * Every action, filed under the heading it belongs to.
 *
 * Derived from the authorisation policy rather than listed here, so an action
 * added to the product appears on this screen the same day, under whichever
 * catalogue it was filed in. A permission page that has to be edited alongside
 * every new action is one that is quietly out of date most of the time.
 */
function describeCatalogues(): PermissionsView['catalogues'] {
  return catalogues.map((catalogue) => ({
    value: catalogue,
    label: CATALOGUES[catalogue].label,
    description: CATALOGUES[catalogue].description,
    actions: CATALOGUES[catalogue].actions.map((action) => ({
      value: action,
      label: describeAction(action),
      description: describeRule(action),
    })),
  }));
}

/**
 * `card.move` as a person would say it.
 *
 * Built from the name rather than a hand-written table, because a table is a
 * second list to keep in step and the failure is an action that appears on this
 * screen with no words next to it.
 */
function describeAction(name: string): string {
  const [subject, verb] = name.split('.');

  if (subject === undefined || verb === undefined) {
    return name;
  }

  return `${capitalise(spaced(verb))} — ${spaced(subject)}`;
}

/** `manageList` reads as `manage list`, `viewList` as `view list`. */
function spaced(word: string): string {
  return word.replace(/([a-z])([A-Z])/gu, '$1 $2').toLowerCase();
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
