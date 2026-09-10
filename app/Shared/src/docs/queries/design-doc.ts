import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { projectSlugSchema } from '../../projects/project-vocabulary.js';

/** One document, as a tab: enough to name it and say how big it is. */
export const documentTabSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  wordCount: z.number().int(),
});

export const openDocumentSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  /** Markdown. Empty is a document nobody has written in yet. */
  body: z.string(),
  wordCount: z.number().int(),
  updatedAt: z.string(),
  /**
   * Who last wrote it.
   *
   * Null for a document nobody has touched since it was made, and for one whose
   * author has since left — the prose outlives the account it was written from.
   */
  updatedBy: z.string().nullable(),
});

export const designDocViewSchema = z.object({
  project: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    code: z.string(),
  }),
  /** Every document this project keeps, in the order of the tabs. */
  documents: z.array(documentTabSchema),
  /** The one being read, or null when the project has none yet. */
  document: openDocumentSchema.nullable(),
  /** Whether this reader may write, which decides whether Edit is offered. */
  canWrite: z.boolean(),
});

export type DesignDocView = z.infer<typeof designDocViewSchema>;
export type DocumentTab = z.infer<typeof documentTabSchema>;
export type OpenDocument = z.infer<typeof openDocumentSchema>;

/**
 * A project's documents, and the one being read.
 *
 * The list of tabs comes back with the document because the tabs are on the
 * same screen: two queries would mean a page that can draw a tab strip with no
 * document under it, or a document under a strip that has not arrived.
 *
 * `docId` is the one to open. Absent means the first, which is what following a
 * link to the design doc should show.
 */
export const designDocQuery = defineQuery(
  'docs.designDoc',
  z.object({ slug: projectSlugSchema, docId: z.string().uuid().optional() }),
  designDocViewSchema,
);
