import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';
import { docBodySchema, docTitleSchema } from '../doc-vocabulary.js';

/**
 * Adds a document to a project.
 *
 * A project starts with none, as its library starts with no categories. What a
 * studio writes down differs by studio, and a project that invented "Game
 * Design Document" on creation would be one everybody renames.
 *
 * `body` is what an import carries. It is here rather than in a second command
 * because creating the document and filling it are one act: split in two, a
 * failed second half leaves an empty tab named after a file nobody can see the
 * contents of, and the person who imported it has no way of telling that from a
 * document that arrived blank.
 *
 * `title` is optional, and left out is how somebody adds a document from the
 * row of tabs: the server names it `New doc`, then `New doc 2`. Named here
 * rather than on the screen because two people adding one at the same moment
 * would otherwise both see `New doc` free and both take it — only the
 * transaction that reads the other names can know which are spoken for.
 */
export const createDesignDocCommand = defineCommand(
  'docs.createDoc',
  z.object({
    projectId: z.string().uuid(),
    title: docTitleSchema.optional(),
    body: docBodySchema.optional(),
  }),
);

export const renameDesignDocCommand = defineCommand(
  'docs.renameDoc',
  z.object({ docId: z.string().uuid(), title: docTitleSchema }),
);

/**
 * Writes a document.
 *
 * The whole body, because it is one document: written top to bottom in one
 * field, with its structure coming from the headings in the prose rather than
 * from anything stored beside it.
 *
 * Last write wins. Two people typing into the same document at once would need
 * a merge this product has nowhere to put yet, and pretending otherwise with
 * per-field patches on a single field would only hide it.
 */
export const updateDesignDocCommand = defineCommand(
  'docs.updateDoc',
  z.object({ docId: z.string().uuid(), body: docBodySchema }),
);

/**
 * Moves a document along the row of tabs.
 *
 * The row is an index, and an index in the order things happened to be made is
 * a list in the order somebody typed. A studio writes the brief, then the audio
 * bible, then wants the one-page pitch first.
 *
 * Said as the two documents it lands between rather than as a number, for the
 * reason `board.moveList` is: a position is a fact about the whole row and a
 * screen that sent one would be sending an opinion about every other document
 * as well. Two neighbours describe one gap, and the server works out what goes
 * in it.
 *
 * The order is the project's rather than one person's. Which document you have
 * open is yours; which order they are in is the index, and an index that read
 * differently to two people is not one.
 */
export const moveDesignDocCommand = defineCommand(
  'docs.moveDoc',
  z.object({
    docId: z.string().uuid(),
    /** The document it should end up in front of. Null means it goes last. */
    beforeDocId: z.string().uuid().nullish(),
    /** The document it should end up behind. Null means it goes first. */
    afterDocId: z.string().uuid().nullish(),
  }),
);

/** Deletes a document and everything written in it. The screen asks first. */
export const deleteDesignDocCommand = defineCommand(
  'docs.deleteDoc',
  z.object({ docId: z.string().uuid() }),
);
