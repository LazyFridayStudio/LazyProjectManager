import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';

const projectReferenceSchema = z.object({ projectId: z.string().uuid() });

/**
 * Takes a project out of the launcher without deleting it.
 *
 * Nothing is removed: its ticket keys, assets and history stay addressable, and
 * a link to a card in an archived project still resolves. Deleting a project
 * outright is not offered, because there is no version of that which does not
 * break links somebody else is holding.
 */
export const archiveProjectCommand = defineCommand('projects.archive', projectReferenceSchema);

/** Puts an archived project back on the launcher. */
export const restoreProjectCommand = defineCommand('projects.restore', projectReferenceSchema);
