import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';
import {
  budgetMinorSchema,
  calendarDateSchema,
  projectCodeSchema,
  projectEngineSchema,
  projectNameSchema,
  projectPhaseSchema,
} from '../project-vocabulary.js';

/**
 * Creates a project and everything it cannot exist without: the ticket counters
 * that issue its card keys, and its first member.
 *
 * The code is asked for rather than derived. `suggestProjectCode` offers one
 * while the name is typed, but it is the root of every ticket key the project
 * will ever issue and cannot be changed afterwards, so a person confirms it.
 */
export const createProjectCommand = defineCommand(
  'projects.create',
  z.object({
    name: projectNameSchema,
    code: projectCodeSchema,
    engine: projectEngineSchema.nullish(),
    phase: projectPhaseSchema.default('prototype'),
    budgetMinor: budgetMinorSchema.nullish(),
    startsOn: calendarDateSchema.nullish(),
    shipsOn: calendarDateSchema.nullish(),
  }),
);
