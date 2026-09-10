import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';

const teamIdSchema = z.string().uuid();
const userIdSchema = z.string().uuid();

export const teamNameSchema = z
  .string()
  .trim()
  .min(1, 'Name the team.')
  .max(60, 'That name is too long for a tile.');

/**
 * Makes a team.
 *
 * A team is how a studio says "these people work on that". It starts with
 * nobody in it and reaches nothing: who is in it and what it can open are both
 * changes somebody makes on purpose afterwards.
 */
export const createTeamCommand = defineCommand(
  'teams.create',
  z.object({
    name: teamNameSchema,
    /** Who answers for it. A team without one is a real state, not a mistake. */
    leadUserId: userIdSchema.nullish(),
  }),
);

/** Renames a team, or changes who answers for it. */
export const updateTeamCommand = defineCommand(
  'teams.update',
  z.object({
    teamId: teamIdSchema,
    name: teamNameSchema.optional(),
    /** Sent as null to leave the team without a lead; left out to keep them. */
    leadUserId: userIdSchema.nullable().optional(),
  }),
);

/**
 * Takes a team off the install.
 *
 * The people in it stay: a team is a grouping, and deleting the group is not
 * deleting the people. Everything the team reached stops being reachable
 * through it, which is the point of deleting one.
 */
export const deleteTeamCommand = defineCommand('teams.delete', z.object({ teamId: teamIdSchema }));

/** Puts somebody in a team. Being in it twice is not being in it more. */
export const addTeamMemberCommand = defineCommand(
  'teams.addMember',
  z.object({ teamId: teamIdSchema, userId: userIdSchema }),
);

/** Takes somebody out of a team, and out of nothing else. */
export const removeTeamMemberCommand = defineCommand(
  'teams.removeMember',
  z.object({ teamId: teamIdSchema, userId: userIdSchema }),
);
