import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';
import {
  permissionEffectSchema,
  permissionGroupNameSchema,
  ruleActionSchema,
} from '../permission-vocabulary.js';

const groupIdSchema = z.string().uuid();

/** A new, empty group. Rules go on afterwards. */
export const createPermissionGroupCommand = defineCommand(
  'permissions.createGroup',
  z.object({ name: permissionGroupNameSchema }),
);

export const renamePermissionGroupCommand = defineCommand(
  'permissions.renameGroup',
  z.object({ groupId: groupIdSchema, name: permissionGroupNameSchema }),
);

/** Takes the group away, and with it every team's hold on it. */
export const deletePermissionGroupCommand = defineCommand(
  'permissions.deleteGroup',
  z.object({ groupId: groupIdSchema }),
);

/**
 * Sets what a group says about one action, or stops it saying anything.
 *
 * One command for all three states rather than an add and a remove, because
 * they are one question with three answers — allow, deny, or nothing — and a
 * screen with a three-way switch should not have to know which of two commands
 * a change maps to.
 */
export const setPermissionRuleCommand = defineCommand(
  'permissions.setRule',
  z.object({
    groupId: groupIdSchema,
    subject: ruleActionSchema,
    /** Null clears the rule, which is not the same as denying. */
    effect: permissionEffectSchema.nullable(),
  }),
);

/** Gives a group to a team, or takes it back. */
export const setTeamPermissionGroupCommand = defineCommand(
  'permissions.setTeamGroup',
  z.object({
    teamId: z.string().uuid(),
    groupId: groupIdSchema,
    held: z.boolean(),
  }),
);

/**
 * Puts a team's permissions in an order.
 *
 * The whole list every time, rather than "this one moved to there". A team
 * holds a handful of groups, the screen already knows the order it is showing,
 * and sending it is one statement of what the list now is — where a move is a
 * description of a change that has to be replayed against whatever the server
 * has, which is a different list if somebody else has been editing.
 *
 * Reading order only. What a team may do is settled by the rules and by `deny`
 * winning where two of them disagree; where a group sits in the list changes
 * the sentence somebody reads and nothing they may do.
 */
export const orderTeamPermissionGroupsCommand = defineCommand(
  'permissions.orderTeamGroups',
  z.object({
    teamId: z.string().uuid(),
    /** Every group the team holds, in the order it should be read. */
    groupIds: z.array(groupIdSchema).max(200),
  }),
);

/**
 * Gives a group to one person, or takes it back.
 *
 * Beside the team's rather than instead of it. A team is how a studio says what
 * a job does, and this is how it says what one person does that their job does
 * not — the contractor who may also record releases, the artist who may also
 * manage the library. Saying that through a team of one was the alternative,
 * and a studio ends up with a team per person.
 */
export const setUserPermissionGroupCommand = defineCommand(
  'permissions.setUserGroup',
  z.object({
    userId: z.string().uuid(),
    groupId: groupIdSchema,
    held: z.boolean(),
  }),
);
