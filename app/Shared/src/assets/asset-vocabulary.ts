import { z } from 'zod';

/**
 * Which broad phase of making an asset is in.
 *
 * Three, and the same everywhere: before anybody builds it, while they do, and
 * once it is in the game. Done and in-review belong to each of the asset's tabs,
 * which is where the work itself is — the asset only says which of these it has
 * reached. Snake case, as a project's phases are.
 *
 * Deliberately not the board's list names. A card moves through whatever columns
 * a studio invents; an asset goes through these, because they are phases of
 * making a thing rather than of managing work.
 */
export const ASSET_PHASES = ['pre_dev', 'dev', 'production'] as const;

export type AssetPhase = (typeof ASSET_PHASES)[number];

export const assetPhaseSchema = z.enum(ASSET_PHASES);

const PHASE_LABELS: Readonly<Record<AssetPhase, string>> = {
  pre_dev: 'Pre-dev',
  dev: 'Dev',
  production: 'Production',
};

export function describeAssetPhase(phase: AssetPhase): string {
  return PHASE_LABELS[phase];
}

/**
 * What a tab can be built from.
 *
 * Notes and a checklist hold what somebody wrote on the tab. Files and work hold
 * nothing of their own: they show the asset's files and hours that say they
 * belong to this tab, and take new ones for it. So the asset still adds its own
 * hours up, and a tab that goes takes nobody's work with it.
 */
export const ASSET_TAB_BLOCK_KINDS = ['notes', 'checklist', 'files', 'work'] as const;

export type AssetTabBlockKind = (typeof ASSET_TAB_BLOCK_KINDS)[number];

export const assetTabBlockKindSchema = z.enum(ASSET_TAB_BLOCK_KINDS);

const BLOCK_LABELS: Readonly<Record<AssetTabBlockKind, string>> = {
  notes: 'Notes',
  checklist: 'Checklist',
  files: 'Files',
  work: 'Work',
};

export function describeAssetTabBlockKind(kind: AssetTabBlockKind): string {
  return BLOCK_LABELS[kind];
}

/**
 * Blocks that show the asset's own files or hours, so a tab has at most one of
 * each: a second would show the same things twice.
 */
export const ASSET_TAB_VIEW_BLOCK_KINDS: readonly AssetTabBlockKind[] = ['files', 'work'];

/** What a tab is called: Mesh, UVs, Rig. Short, because it sits in a row of them. */
export const assetTabTitleSchema = z.string().trim().min(1, 'Name the tab.').max(60);

/** What a notes block says. As long as a description may be. */
export const assetTabNotesSchema = z.string().max(20_000);

/** One line of a checklist on a tab, held to what a card's step is held to. */
export const assetChecklistItemTitleSchema = z
  .string()
  .trim()
  .min(1, 'Say what the item is.')
  .max(200);

/** What a template is called in the picker: Rigged creature, Static prop. */
export const assetTemplateNameSchema = z.string().trim().min(1, 'Name the template.').max(100);

/**
 * The most tabs one asset has, and the most blocks one tab has.
 *
 * Not a rule about how anybody should work — past these a row of tabs is a
 * scrolling strip, and a tab is a page nobody reads to the bottom of.
 */
export const MAXIMUM_TABS_PER_ASSET = 30;
export const MAXIMUM_BLOCKS_PER_TAB = 20;
export const MAXIMUM_ITEMS_PER_CHECKLIST = 100;

/**
 * One block as a template keeps it.
 *
 * What it says and nothing about who did it: a checklist's items come back
 * unticked, and a files or work block comes back empty, because the files and
 * hours belonged to the asset it was saved from.
 */
export const assetTemplateBlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('notes'), body: assetTabNotesSchema }),
  z.object({
    kind: z.literal('checklist'),
    items: z.array(assetChecklistItemTitleSchema).max(MAXIMUM_ITEMS_PER_CHECKLIST),
  }),
  z.object({ kind: z.literal('files') }),
  z.object({ kind: z.literal('work') }),
]);

export type AssetTemplateBlock = z.infer<typeof assetTemplateBlockSchema>;

/**
 * What a template is: the tabs to make, in order, and what each is built from.
 *
 * No assignee, no due date and nothing ticked. Those are about one asset; a
 * template is about the kind of thing it is.
 */
export const assetTemplateDefinitionSchema = z.object({
  tabs: z
    .array(
      z.object({
        title: assetTabTitleSchema,
        blocks: z.array(assetTemplateBlockSchema).max(MAXIMUM_BLOCKS_PER_TAB),
      }),
    )
    .max(MAXIMUM_TABS_PER_ASSET),
});

export type AssetTemplateDefinition = z.infer<typeof assetTemplateDefinitionSchema>;

export const assetNameSchema = z.string().trim().min(1).max(200);

/**
 * The longest name a category may have.
 *
 * Its own constant because a person is no longer the only thing that names a
 * category: one coming up out of a deleted category into a name that is taken
 * is given another, and that has to be a name the edit dialog would accept.
 */
export const MAXIMUM_ASSET_CATEGORY_NAME_LENGTH = 100;

export const assetCategoryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAXIMUM_ASSET_CATEGORY_NAME_LENGTH);

/**
 * A colour a category is drawn in.
 *
 * The same shape a list's colour takes, so the two screens agree about what a
 * colour is and neither has to sanitise the other's.
 */
export const assetCategoryColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-f]{6}$/i, 'A colour is six hexadecimal digits after a hash.');

/**
 * Money, in minor units, as everywhere else.
 *
 * The same ceiling the project's budget uses: above this it is not a number
 * anybody typed on purpose.
 */
export const assetCostMinorSchema = z.number().int().min(0).max(1_000_000_000_000);

/**
 * The middle of an asset's key: `EXMP-AST-6`.
 *
 * Deliberately the shape a ticket key has, because it is the same idea — a
 * short thing to say out loud. "The crate" is ambiguous across two
 * projects and `EXMP-AST-6` is not.
 */
export const ASSET_KEY_PREFIX = 'AST';

/**
 * Where assets go when the category holding them is deleted.
 *
 * Made when it is first needed rather than with the project: a library that
 * came with an empty "Unorganised" in it would be a library where the first
 * thing everybody does is wonder what it is for.
 *
 * Grey, because it is not a kind of thing — it is the absence of one.
 */
export const DEFAULT_ASSET_CATEGORY = { name: 'Unorganised', color: '#7a7a7a' } as const;

/**
 * The most tags one asset carries.
 *
 * Not a rule about how anybody should work — it is the point past which a tile
 * is a wall of chips with a picture somewhere behind it.
 */
export const MAXIMUM_TAGS_PER_ASSET = 20;

/**
 * A word an asset is filed under.
 *
 * Normalised rather than policed: `Act 1`, `act 1` and `ACT-1` are one tag, and
 * a library where they are three is a library where filtering by any of them
 * finds a third of what it should. Lower case and hyphens, which is the form
 * every tag in the design is already written in.
 */
export const assetTagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/[\s_]+/g, '-').replace(/-{2,}/g, '-'))
  .refine((value) => value.length > 0, 'Name the tag.')
  .refine((value) => value.length <= 40, 'That is longer than a tag wants to be.')
  .refine((value) => /^[a-z0-9][a-z0-9-]*$/.test(value), 'A tag is letters, numbers and hyphens.');

/** What a file is called in an asset's list. The filename, for an upload. */
export const assetFileLabelSchema = z.string().trim().min(1).max(200);

/**
 * Where a file lives, when it does not live here.
 *
 * Held to `http` and `https` on purpose. `javascript:` in an href is the oldest
 * trick there is, and `file:` is a path on whichever machine happens to be
 * reading it — neither is a place anybody can send a colleague.
 */
export const assetFileUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine(
    (value) => {
      try {
        const { protocol } = new URL(value);

        return protocol === 'http:' || protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'That needs to be a full http or https address.' },
  );
