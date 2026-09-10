import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { projectSlugSchema } from '../../projects/project-vocabulary.js';
import { releaseSourceSchema } from '../release-vocabulary.js';

export const releaseAssetSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** Bytes, or null for a file nobody measured. The screen writes the unit. */
  sizeBytes: z.number().int().nullable(),
  downloadCount: z.number().int(),
  /** Where to get it, or null for a download nobody has said the whereabouts of. */
  downloadUrl: z.string().nullable(),
});

export const releaseSchema = z.object({
  id: z.string().uuid(),
  /** `hand`, or the forge that owns this row and refreshes it on every sync. */
  source: releaseSourceSchema,
  tag: z.string(),
  name: z.string(),
  publishedOn: z.string(),
  author: z.string(),
  commitSha: z.string().nullable(),
  isPrerelease: z.boolean(),
  isDraft: z.boolean(),
  /** Markdown. Empty is a release nobody has written notes for yet. */
  notes: z.string(),
  runLabel: z.string().nullable(),
  url: z.string().nullable(),
  assets: z.array(releaseAssetSchema),
});

/**
 * The repository this page can fill itself from, and what it last did.
 *
 * Null when no repository is connected at all. `canRead` is separate from
 * having a connection because a project can be wired up for webhooks and still
 * have no credential to read with — which is the state every Gitea and GitLab
 * connection is in today, and a "Re-sync" button that fails on press is worse
 * than one that says why it cannot.
 */
export const releaseSyncSchema = z.object({
  provider: z.string(),
  repoFullName: z.string(),
  canRead: z.boolean(),
  /** Null until somebody has pulled once. */
  syncedAt: z.string().nullable(),
});

export const buildsViewSchema = z.object({
  project: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    code: z.string(),
  }),
  /**
   * The one at the top of the page, or null for a project that has shipped
   * nothing yet.
   *
   * Its own field rather than the first of the list, because it is drawn as a
   * different thing: the headline gets its notes and its downloads, and the
   * rest are two lines each. A screen that had to slice the list to find out
   * which was which would be one slice away from drawing the wrong one.
   */
  latest: releaseSchema.nullable(),
  /** Everything published before it, newest first. */
  earlier: z.array(releaseSchema),
  /** Whether this reader may record one, which decides what is offered. */
  canWrite: z.boolean(),
  /** The repository this page can fill itself from, or null for none. */
  sync: releaseSyncSchema.nullable(),
});

export type BuildsView = z.infer<typeof buildsViewSchema>;
export type ReleaseSync = z.infer<typeof releaseSyncSchema>;
export type Release = z.infer<typeof releaseSchema>;
export type ReleaseAsset = z.infer<typeof releaseAssetSchema>;

/**
 * What a project has shipped.
 *
 * Every release at once, because a studio has tens of these rather than
 * thousands and the page shows the whole history down the side. The day this
 * needs a page size is the day it is worth paging.
 */
export const buildsQuery = defineQuery(
  'releases.builds',
  z.object({ slug: projectSlugSchema }),
  buildsViewSchema,
);
