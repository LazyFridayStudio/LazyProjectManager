import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';
import { calendarDateSchema } from '../../projects/project-vocabulary.js';
import {
  assetChecklistItemTitleSchema,
  assetTabBlockKindSchema,
  assetTabNotesSchema,
  assetTabTitleSchema,
  assetTemplateDefinitionSchema,
  assetTemplateNameSchema,
} from '../asset-vocabulary.js';

/**
 * Adds a tab to an asset: one job inside it, such as Mesh or Rig. It goes on
 * the end of the ones already there, and starts empty.
 */
export const addAssetTabCommand = defineCommand(
  'assets.addTab',
  z.object({
    assetId: z.string().uuid(),
    title: assetTabTitleSchema,
  }),
);

/**
 * Renames a tab, ticks it off, or says who is doing it and by when.
 *
 * Every field optional and at least one required, the way a card's step is: the
 * checkbox sends `done` alone and the rename sends `title` alone. Null takes the
 * person or the date off.
 */
export const updateAssetTabCommand = defineCommand(
  'assets.updateTab',
  z
    .object({
      assetTabId: z.string().uuid(),
      title: assetTabTitleSchema.optional(),
      done: z.boolean().optional(),
      /** Who is doing this part, which is often not who owns the asset. */
      assigneeId: z.string().uuid().nullable().optional(),
      dueOn: calendarDateSchema.nullable().optional(),
    })
    .refine(
      (input) =>
        input.title !== undefined ||
        input.done !== undefined ||
        input.assigneeId !== undefined ||
        input.dueOn !== undefined,
      'Say what to change about the tab.',
    ),
);

/**
 * Moves a tab along the row.
 *
 * Neighbours rather than an index, as every other reorder takes it: an index
 * means something different by the time it arrives, because somebody else may
 * have added a tab in front of it.
 */
export const moveAssetTabCommand = defineCommand(
  'assets.moveTab',
  z.object({
    assetTabId: z.string().uuid(),
    /** The tab it should end up in front of, if any. */
    beforeTabId: z.string().uuid().nullish(),
    /** The tab it should end up behind, if any. */
    afterTabId: z.string().uuid().nullish(),
  }),
);

/**
 * Takes a tab off an asset, with its notes and checklists.
 *
 * It waits a week in the bin. The files and hours that said they were for it
 * stay on the asset either way, untagged, and get their tag back if the tab is
 * put back.
 */
export const deleteAssetTabCommand = defineCommand(
  'assets.deleteTab',
  z.object({ assetTabId: z.string().uuid() }),
);

/**
 * Adds a block to a tab, on the end of the ones already there.
 *
 * A notes block may arrive with what it says; every other kind starts empty. A
 * tab has at most one files block and one work block, because each shows what
 * is tagged to the tab and a second would show it twice.
 */
export const addAssetTabBlockCommand = defineCommand(
  'assets.addBlock',
  z.object({
    assetTabId: z.string().uuid(),
    kind: assetTabBlockKindSchema,
    body: assetTabNotesSchema.optional(),
  }),
);

/** Changes what a notes block says. Nothing else has text of its own to change. */
export const updateAssetTabBlockCommand = defineCommand(
  'assets.updateBlock',
  z.object({
    blockId: z.string().uuid(),
    body: assetTabNotesSchema,
  }),
);

/** Moves a block up or down its tab, by the neighbours it should end up between. */
export const moveAssetTabBlockCommand = defineCommand(
  'assets.moveBlock',
  z.object({
    blockId: z.string().uuid(),
    /** The block it should end up above, if any. */
    beforeBlockId: z.string().uuid().nullish(),
    /** The block it should end up below, if any. */
    afterBlockId: z.string().uuid().nullish(),
  }),
);

/**
 * Takes a block off a tab.
 *
 * A notes or checklist block really goes, the way a card's step does: it is an
 * edit to a tab rather than the loss of one. A files or work block only stops
 * showing what it showed — the files and hours are the asset's.
 */
export const removeAssetTabBlockCommand = defineCommand(
  'assets.removeBlock',
  z.object({ blockId: z.string().uuid() }),
);

/** Adds an item to a checklist block, on the end. */
export const addAssetChecklistItemCommand = defineCommand(
  'assets.addChecklistItem',
  z.object({
    blockId: z.string().uuid(),
    title: assetChecklistItemTitleSchema,
  }),
);

/** Ticks an item off, unticks it, or renames it. At least one of the two. */
export const updateAssetChecklistItemCommand = defineCommand(
  'assets.updateChecklistItem',
  z
    .object({
      itemId: z.string().uuid(),
      title: assetChecklistItemTitleSchema.optional(),
      done: z.boolean().optional(),
    })
    .refine(
      (input) => input.title !== undefined || input.done !== undefined,
      'Say what to change about the item.',
    ),
);

/** Takes an item off a checklist. One line somebody typed, so this really deletes. */
export const removeAssetChecklistItemCommand = defineCommand(
  'assets.removeChecklistItem',
  z.object({ itemId: z.string().uuid() }),
);

/**
 * Keeps a set of tabs for the project to start assets from.
 *
 * The definition is the whole of it, so a template can be written by hand by an
 * agent as easily as saved from an asset: the panel builds it from the asset's
 * tabs with `templateFromTabs` and sends that.
 */
export const createAssetTemplateCommand = defineCommand(
  'assets.createTemplate',
  z.object({
    projectId: z.string().uuid(),
    name: assetTemplateNameSchema,
    definition: assetTemplateDefinitionSchema,
  }),
);

/**
 * Renames a template, or replaces what is in it.
 *
 * Replacing is how a template is changed: save the asset that shows how it
 * should be over the one that does not. Assets already started from it keep the
 * tabs they were given — a template is where an asset starts, not a rule it
 * follows.
 */
export const updateAssetTemplateCommand = defineCommand(
  'assets.updateTemplate',
  z
    .object({
      templateId: z.string().uuid(),
      name: assetTemplateNameSchema.optional(),
      definition: assetTemplateDefinitionSchema.optional(),
    })
    .refine(
      (input) => input.name !== undefined || input.definition !== undefined,
      'Say what to change about the template.',
    ),
);

/**
 * Deletes a template. Assets started from it keep their tabs, and a category
 * that offered it offers nothing.
 */
export const deleteAssetTemplateCommand = defineCommand(
  'assets.deleteTemplate',
  z.object({ templateId: z.string().uuid() }),
);

/**
 * Adds a template's tabs to an asset, after the ones it already has.
 *
 * Adds and never replaces: an asset halfway through its work has tabs with
 * hours and files on them, and applying a template should not be a way to lose
 * any of that.
 */
export const applyAssetTemplateCommand = defineCommand(
  'assets.applyTemplate',
  z.object({
    assetId: z.string().uuid(),
    templateId: z.string().uuid(),
  }),
);
