import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { projectSectionSchema } from '../project-sections.js';
import { projectSlugSchema } from '../project-vocabulary.js';

/**
 * A category as the sidebar lists it.
 *
 * Just enough to draw a line in a tree: what it is called, what colour it is
 * drawn in, and how much is in it. The library's own view carries budgets and
 * tiles, and none of that belongs in a nav.
 */
export const workspaceCategorySchema = z.object({
  id: z.string().uuid(),
  /**
   * How far in it sits, so the nav can draw the shape the library is in.
   *
   * A depth rather than the parent's id, because the sidebar draws a flat list
   * of links and never has to ask what is inside what — the rows arrive in
   * reading order and each one only needs to know how far to indent.
   */
  depth: z.number().int(),
  name: z.string(),
  color: z.string(),
  /** Everything under it, matching what the library says beside the same name. */
  count: z.number().int(),
});

export type WorkspaceCategory = z.infer<typeof workspaceCategorySchema>;

/**
 * What the sidebar knows about a project.
 *
 * A query of its own rather than something each screen passes down, because the
 * sidebar is on every screen and shows the same numbers on all of them — the
 * count beside `Assets` has to be right while somebody is looking at the board,
 * and the board has no idea what it is.
 */
export const projectWorkspaceViewSchema = z.object({
  project: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    /** The mark in the corner. Null is drawn as the first letter of the name. */
    logoUrl: z.string().nullable(),
  }),
  /** Everything in the library, which is what the badge beside `Assets` says. */
  assetCount: z.number().int(),
  /** Open cards only: a badge counting finished work would only ever grow. */
  openCardCount: z.number().int(),
  categories: z.array(workspaceCategorySchema),
  /**
   * The screens of this project this person may open.
   *
   * Decided here rather than worked out in the sidebar, for the reason the
   * install's tabs are: a permission group can allow or deny anything to
   * anybody, so a nav that guessed from a role would draw the wrong doors — and
   * a project's answer is not the install's, because a rule can allow something
   * to somebody on the project and not to somebody in a team on it.
   *
   * This hides what would be refused. It grants nothing: every screen behind
   * these asks the same question again for itself.
   *
   * It is also narrowed by the sections the project has switched off, which is
   * `disabledSections` below — the sidebar wants one list and does not care
   * which of the two reasons kept a door out of it.
   */
  sections: z.array(projectSectionSchema),
  /**
   * The sections this project does not use, whatever anybody may open.
   *
   * Separate from `sections` because a screen reached by its URL has to say
   * which of the two happened: "this project does not use Timeline" is a
   * different sentence from "that is not yours to open", and answering the
   * second with the first sends somebody to ask for a permission they already
   * have.
   */
  disabledSections: z.array(projectSectionSchema),
});

export type ProjectWorkspaceView = z.infer<typeof projectWorkspaceViewSchema>;

export const projectWorkspaceQuery = defineQuery(
  'projects.workspace',
  z.object({ slug: projectSlugSchema }),
  projectWorkspaceViewSchema,
);
