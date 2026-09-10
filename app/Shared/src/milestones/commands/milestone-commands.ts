import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';
import { calendarDateSchema } from '../../projects/project-vocabulary.js';
import {
  milestoneCapacitySchema,
  milestoneGoalSchema,
  milestoneNameSchema,
} from '../milestone-vocabulary.js';

/**
 * Adds a date the project is held to.
 *
 * Both dates are required. A milestone with no end is a wish, and the whole
 * point of a release plan is that each of these lands on a day.
 */
export const createMilestoneCommand = defineCommand(
  'milestones.create',
  z.object({
    projectId: z.string().uuid(),
    name: milestoneNameSchema,
    goal: milestoneGoalSchema.nullish(),
    startsOn: calendarDateSchema,
    shipsOn: calendarDateSchema,
    capacityPoints: milestoneCapacitySchema.nullish(),
  }),
);

/**
 * Changes a milestone.
 *
 * Every field is optional and an absent one means "leave it". Dates are checked
 * against the merged result rather than against what arrived, because moving
 * only the end can still put it before a start that was already there.
 */
export const updateMilestoneCommand = defineCommand(
  'milestones.update',
  z.object({
    milestoneId: z.string().uuid(),
    name: milestoneNameSchema.optional(),
    goal: milestoneGoalSchema.nullish(),
    startsOn: calendarDateSchema.optional(),
    shipsOn: calendarDateSchema.optional(),
    capacityPoints: milestoneCapacitySchema.nullish(),
  }),
);

/**
 * Takes a milestone out of the plan.
 *
 * The cards promised for it are unpromised rather than deleted: a date being
 * dropped does not mean the work was. The screen says how many that is before
 * it asks.
 */
export const deleteMilestoneCommand = defineCommand(
  'milestones.delete',
  z.object({ milestoneId: z.string().uuid() }),
);
