import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';
import { subtaskTitleSchema } from '../../board/commands/activity-commands.js';
import { calendarDateSchema } from '../../projects/project-vocabulary.js';
import {
  assetCategoryColorSchema,
  assetCategoryNameSchema,
  assetCostMinorSchema,
  assetFileLabelSchema,
  assetFileUrlSchema,
  assetNameSchema,
  assetStatusSchema,
  assetTagSchema,
} from '../asset-vocabulary.js';

/**
 * Adds a category to a project's library.
 *
 * A project starts with none, because what a game is made of differs by game —
 * "World Bosses" and "Weapons — Tier 3" mean nothing to a studio making a
 * puzzler. Defaults would be four categories everybody deletes.
 */
export const createAssetCategoryCommand = defineCommand(
  'assets.createCategory',
  z.object({
    projectId: z.string().uuid(),
    /**
     * The category to put it inside, and absent for one at the top.
     *
     * Any depth: a sub-category may itself hold sub-categories, because a
     * studio with three kinds of prop and five kinds of each has a shape, and a
     * product that stops at two levels makes them go back to naming things
     * `Props — Interior — Destructible`.
     */
    parentId: z.string().uuid().nullish(),
    name: assetCategoryNameSchema,
    color: assetCategoryColorSchema,
    budgetMinor: assetCostMinorSchema.nullish(),
  }),
);

/**
 * Changes a category.
 *
 * Every field is optional and an absent one means "leave it", as it does on an
 * asset: the dialog owns all of them and sends all of them, but a script
 * recolouring one category across a project should not have to restate its
 * budget to do it.
 */
export const updateAssetCategoryCommand = defineCommand(
  'assets.updateCategory',
  z.object({
    categoryId: z.string().uuid(),
    name: assetCategoryNameSchema.optional(),
    color: assetCategoryColorSchema.optional(),
    budgetMinor: assetCostMinorSchema.nullish(),
  }),
);

/**
 * Moves a category: somewhere else in the order, inside something else, or both.
 *
 * The order of the headings is the order a studio thinks about what it is
 * making — characters before props before UI, or whichever way round this
 * studio works — and until now it was the order the categories happened to be
 * made in. Named neighbours rather than an index, as everything else that is
 * ordered by hand takes it: an index means something different by the time it
 * arrives, because somebody else may have dropped a category above it.
 *
 * `parentId` is where it lands, and the neighbours order it among what is
 * already there — the same pair `board.moveCard` takes, for the same reason: a
 * list and a position are two facts and a move can change either.
 */
export const moveAssetCategoryCommand = defineCommand(
  'assets.moveCategory',
  z.object({
    categoryId: z.string().uuid(),
    /**
     * The category it should end up inside, null for the top level, and absent
     * to leave it where it is.
     *
     * Three meanings rather than two, which is why this is nullish rather than
     * optional: "put it at the top" and "do not move it" are different moves,
     * and a reorder among siblings should not have to name the parent it is
     * already in.
     */
    parentId: z.string().uuid().nullish(),
    /** The category it should end up above, if any. */
    beforeCategoryId: z.string().uuid().nullish(),
    /** The category it should end up below, if any. */
    afterCategoryId: z.string().uuid().nullish(),
  }),
);

/**
 * Takes a category out of a project's library.
 *
 * What it held is not deleted with it: assets move to `Unorganised`, which is
 * made if it is not there yet. A category is how a studio files things and
 * refiling is not the same as throwing away — somebody reorganising a library
 * would otherwise have to move eight assets by hand before they were allowed
 * to drop the heading they no longer want.
 */
export const deleteAssetCategoryCommand = defineCommand(
  'assets.deleteCategory',
  z.object({ categoryId: z.string().uuid() }),
);

/**
 * Adds a thing the game needs.
 *
 * Only a name and a category are asked for. Everything else about an asset is
 * learned while making it, and a form that insists on a cost estimate before the
 * concept exists is a form people put fake numbers into.
 */
export const createAssetCommand = defineCommand(
  'assets.createAsset',
  z.object({
    projectId: z.string().uuid(),
    categoryId: z.string().uuid(),
    name: assetNameSchema,
    status: assetStatusSchema.default('concept'),
    description: z.string().max(20_000).nullish(),
    estimatedCostMinor: assetCostMinorSchema.nullish(),
    dueOn: calendarDateSchema.nullish(),
  }),
);

/**
 * Changes an asset.
 *
 * Every field is optional and an absent one means "leave it", which is what
 * makes two people editing different things at once safe. The panel owns all of
 * them and sends all of them, so it never relies on that — but a script fixing
 * one field across a hundred assets does.
 */
export const updateAssetCommand = defineCommand(
  'assets.updateAsset',
  z.object({
    assetId: z.string().uuid(),
    /** Moving it to another category, which is a re-filing rather than an edit. */
    categoryId: z.string().uuid().optional(),
    name: assetNameSchema.optional(),
    status: assetStatusSchema.optional(),
    description: z.string().max(20_000).nullish(),
    estimatedCostMinor: assetCostMinorSchema.nullish(),
    dueOn: calendarDateSchema.nullish(),
    /** Who is making it. Null is nobody yet, which most of a library is. */
    assigneeId: z.string().uuid().nullable().optional(),
    /**
     * Who asked for it, which is not always who filed it.
     *
     * Set to whoever added the asset and changeable afterwards, exactly as a
     * card's is: a producer fills a library on somebody else's behalf, and the
     * person worth going back to about a thin brief is the one who wanted it.
     */
    reporterId: z.string().uuid().nullable().optional(),
  }),
);

/**
 * Says a card is about an asset.
 *
 * One relation rather than several: a card relates to another card in a few ways
 * — it blocks, is blocked by, duplicates — but there is only one thing it can be
 * to an asset, which is about it.
 */
export const linkAssetCommand = defineCommand(
  'assets.linkCard',
  z.object({
    cardId: z.string().uuid(),
    assetId: z.string().uuid(),
  }),
);

/** Takes that back. The card and the asset both stay where they are. */
export const unlinkAssetCommand = defineCommand(
  'assets.unlinkCard',
  z.object({ linkId: z.string().uuid() }),
);

/**
 * Takes a picture off an asset.
 *
 * The object stays in the store, as it does when a file leaves a card: the same
 * file can be a reference on more than one asset, and deleting the bytes because
 * one of them let go would break the others.
 */
export const removeAssetReferenceCommand = defineCommand(
  'assets.removeReference',
  z.object({ referenceId: z.string().uuid() }),
);

/**
 * Makes one of the pictures the first one.
 *
 * Which is also the one the tile shows, so this is how somebody says "that is
 * what this asset looks like" — a reorder rather than a separate column, because
 * a column would let the two disagree.
 */
/**
 * Moves a reference within the sheet.
 *
 * Neighbours rather than an index, as a card move is: an index means something
 * different by the time it arrives, because somebody else may have dropped two
 * more renders in above it.
 *
 * Dropping one at the front is the same act as promoting it — the first picture
 * is what the library tile draws — so this is the general form of the button
 * beside it rather than a second way of saying the same thing.
 */
export const moveAssetReferenceCommand = defineCommand(
  'assets.moveReference',
  z.object({
    referenceId: z.string().uuid(),
    /** The reference it should end up before, if any. */
    beforeReferenceId: z.string().uuid().nullish(),
    /** The reference it should end up after, if any. */
    afterReferenceId: z.string().uuid().nullish(),
  }),
);

export const promoteAssetReferenceCommand = defineCommand(
  'assets.promoteReference',
  z.object({ referenceId: z.string().uuid() }),
);

/**
 * Points an asset at a file that lives somewhere else.
 *
 * The other half of uploading one. A studio with a Perforce depot, a NAS or a
 * shared drive already has the source file somewhere, and a library that could
 * only hold copies would be a library holding out-of-date copies.
 */
export const linkAssetFileCommand = defineCommand(
  'assets.linkFile',
  z.object({
    assetId: z.string().uuid(),
    label: assetFileLabelSchema,
    url: assetFileUrlSchema,
  }),
);

/**
 * Takes a file off an asset.
 *
 * An uploaded one keeps its bytes in the store, as it does when it leaves a
 * card: the same file can hang off more than one thing. A linked one was never
 * ours to delete.
 */
export const removeAssetFileCommand = defineCommand(
  'assets.removeFile',
  z.object({ assetFileId: z.string().uuid() }),
);

/**
 * Files an asset under a word.
 *
 * Asking twice is not an error, the way linking a card twice is not: somebody
 * pressing a button again because the first press did not look like it worked
 * should end up with the tag they wanted.
 */
export const tagAssetCommand = defineCommand(
  'assets.addTag',
  z.object({
    assetId: z.string().uuid(),
    tag: assetTagSchema,
  }),
);

/** Takes the word off again. */
export const untagAssetCommand = defineCommand(
  'assets.removeTag',
  z.object({
    assetId: z.string().uuid(),
    tag: assetTagSchema,
  }),
);

/**
 * Adds a stage to an asset. It goes on the end of the ones already there.
 *
 * Freeform rather than chosen from a list: Mesh, UV, Texture and Animation are
 * what a character happens to need, and a prop, a sound and a cinematic each
 * want a different set. A fixed pipeline here would be an opinion about how a
 * studio works that this product does not hold.
 */
export const addAssetSubtaskCommand = defineCommand(
  'assets.addSubtask',
  z.object({
    assetId: z.string().uuid(),
    title: subtaskTitleSchema,
  }),
);

/**
 * Ticks a stage off, unticks it, or renames it.
 *
 * Both fields optional and at least one required, the way a card's is: the
 * checkbox sends `done` alone and the rename sends `title` alone, and a command
 * that demanded both would make each of them send back what it did not change.
 */
export const updateAssetSubtaskCommand = defineCommand(
  'assets.updateSubtask',
  z
    .object({
      assetSubtaskId: z.string().uuid(),
      title: subtaskTitleSchema.optional(),
      done: z.boolean().optional(),
    })
    .refine(
      (input) => input.title !== undefined || input.done !== undefined,
      'Say what to change about the stage.',
    ),
);

/** Removes a stage. Stages are working notes, so this really does delete. */
export const removeAssetSubtaskCommand = defineCommand(
  'assets.removeSubtask',
  z.object({ assetSubtaskId: z.string().uuid() }),
);

/**
 * Moves an asset, within a category or into another one.
 *
 * Named neighbours rather than an index, the way a card moves: an index means
 * something different by the time it arrives, because somebody else may have
 * dropped an asset above it. Naming what it should sit between is a request
 * that still makes sense when the library has moved on.
 *
 * Dragging into another category is a move rather than a copy, and it is how a
 * card changes list — the same gesture on the same kind of screen should not
 * mean two different things.
 */
export const moveAssetCommand = defineCommand(
  'assets.move',
  z.object({
    assetId: z.string().uuid(),
    toCategoryId: z.string().uuid(),
    /** The asset it should end up in front of, if any. */
    beforeAssetId: z.string().uuid().nullish(),
    /** The asset it should end up behind, if any. */
    afterAssetId: z.string().uuid().nullish(),
  }),
);
