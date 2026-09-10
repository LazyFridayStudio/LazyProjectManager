import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';
import {
  budgetMinorSchema,
  calendarDateSchema,
  projectEngineSchema,
  projectNameSchema,
  projectPhaseSchema,
  syncEverySecondsSchema,
} from '../project-vocabulary.js';
import { switchableProjectSectionSchema } from '../project-sections.js';

/**
 * Edits a project from its settings screen.
 *
 * Every field is optional and only the ones present are written, so two people
 * editing different parts of the same project do not overwrite each other.
 * `null` clears a field; leaving it out keeps it.
 *
 * `code` is absent deliberately. Ticket keys already issued carry it, and
 * changing it would leave EXMP-ART-208 pointing at a project called something
 * else. A project that needs a different code is a new project.
 */
export const updateProjectCommand = defineCommand(
  'projects.update',
  z.object({
    projectId: z.string().uuid(),
    name: projectNameSchema.optional(),
    engine: projectEngineSchema.nullable().optional(),
    phase: projectPhaseSchema.optional(),
    budgetMinor: budgetMinorSchema.nullable().optional(),
    startsOn: calendarDateSchema.nullable().optional(),
    shipsOn: calendarDateSchema.nullable().optional(),
    /** Set while nobody will commit to a start or ship date yet. */
    datesTbd: z.boolean().optional(),
    /**
     * The sections this project does not use, sent whole rather than toggled.
     *
     * The whole set every time, because that is how the panel saves it and it
     * is what makes two people switching different sections at once resolve to
     * one answer rather than half of each.
     */
    disabledSections: z.array(switchableProjectSectionSchema).optional(),
    /**
     * Whether a sync leaves the repository's closed history where it is.
     *
     * On the project because it is a decision about this board rather than
     * about the credentials it reads with, the same as `wipIsAdvisory`.
     */
    syncOpenIssuesOnly: z.boolean().optional(),
    /**
     * How often the clock comes round for this repository, and null for never.
     *
     * Nullable rather than a very large number, because "leave it alone" is a
     * different answer from "rarely" — and absent still means "leave this field
     * as it is", which is the two meanings that would collide if Off were
     * absence.
     */
    syncEverySeconds: syncEverySecondsSchema.nullable().optional(),
  }),
);
