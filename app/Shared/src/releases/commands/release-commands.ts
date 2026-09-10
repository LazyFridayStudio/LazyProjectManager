import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';
import {
  releaseAuthorSchema,
  releaseDaySchema,
  releaseNameSchema,
  releaseNotesSchema,
  releaseTagSchema,
} from '../release-vocabulary.js';

/**
 * One downloadable file, as it arrives with the release it belongs to.
 *
 * Sent together rather than added afterwards, because a release and the builds
 * it produced are one act: a release recorded without its downloads is one
 * somebody has to go back and finish, and the half-finished state is visible on
 * the page to everybody else in the meantime.
 */
const releaseAssetInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** Bytes. Null for a file nobody measured, which is not an error. */
  sizeBytes: z.number().int().nonnegative().nullish(),
  downloadCount: z.number().int().nonnegative().optional(),
  /**
   * Where the file is.
   *
   * Checked here rather than at the database, because this is the one place the
   * failure can be told to the person typing it. Null for a download somebody
   * has named but not linked, which is not an error either — the row simply
   * offers nothing to press.
   */
  downloadUrl: z.string().trim().url().max(1000).nullish(),
});

/**
 * Records something the project shipped.
 *
 * Entered by hand, which is the design's own answer for a studio with no CI
 * connected: "the Builds page stays available and you add each run and release
 * yourself". A later step filling these in from GitHub Actions writes the same
 * rows through the same command.
 */
export const recordReleaseCommand = defineCommand(
  'releases.record',
  z.object({
    projectId: z.string().uuid(),
    tag: releaseTagSchema,
    name: releaseNameSchema,
    publishedOn: releaseDaySchema,
    author: releaseAuthorSchema,
    commitSha: z.string().trim().max(80).nullish(),
    isPrerelease: z.boolean().optional(),
    isDraft: z.boolean().optional(),
    notes: releaseNotesSchema.optional(),
    runLabel: z.string().trim().max(120).nullish(),
    url: z.string().trim().url().max(500).nullish(),
    assets: z.array(releaseAssetInputSchema).max(50).optional(),
  }),
);

/**
 * Changes a release.
 *
 * Every field is optional and an absent one means "leave it" — except `assets`,
 * which replaces the list when it is given. A download that was removed from a
 * release is not a download with a flag on it, and patching a list item by item
 * through one command is how two people editing the same release end up with
 * each other's files.
 */
export const updateReleaseCommand = defineCommand(
  'releases.update',
  z.object({
    releaseId: z.string().uuid(),
    tag: releaseTagSchema.optional(),
    name: releaseNameSchema.optional(),
    publishedOn: releaseDaySchema.optional(),
    author: releaseAuthorSchema.optional(),
    commitSha: z.string().trim().max(80).nullish(),
    isPrerelease: z.boolean().optional(),
    isDraft: z.boolean().optional(),
    notes: releaseNotesSchema.optional(),
    runLabel: z.string().trim().max(120).nullish(),
    url: z.string().trim().url().max(500).nullish(),
    assets: z.array(releaseAssetInputSchema).max(50).optional(),
  }),
);

/** Takes a release off the page. The downloads listed under it go with it. */
export const deleteReleaseCommand = defineCommand(
  'releases.delete',
  z.object({ releaseId: z.string().uuid() }),
);

/**
 * Reads the connected repository's releases in.
 *
 * A pull rather than a push, so a studio can ask for it: a repository connected
 * after the fact has years of releases the page has never heard of, and waiting
 * for the next `release` webhook would mean waiting for the next release.
 *
 * Only the project is named. What to read is whatever the connection points at,
 * because a command that took a repository would be a second place the answer
 * to "which repository is this project's" could be wrong.
 */
export const syncReleasesCommand = defineCommand(
  'releases.sync',
  z.object({ projectId: z.string().uuid() }),
);
