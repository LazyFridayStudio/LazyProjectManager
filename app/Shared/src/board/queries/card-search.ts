import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { assetStatusSchema } from '../../assets/asset-vocabulary.js';
import { cardTypeSchema } from '../board-vocabulary.js';

/**
 * How many of each kind a search offers.
 *
 * Enough to recognise the one you meant, few enough to read without scrolling.
 * A longer list is a list nobody reads to the end of. Counted per kind rather
 * than across both, so a project with a big board cannot crowd its library out
 * of its own search.
 */
export const MAXIMUM_CARD_SUGGESTIONS = 7;

/**
 * The shortest search worth running.
 *
 * Two characters of a key match most of the board, so the suggestions would be
 * noise and the query would run on every keystroke of a word nobody has finished
 * typing.
 */
export const MINIMUM_SEARCH_LENGTH = 3;

export const cardSuggestionSchema = z.object({
  id: z.string().uuid(),
  cardKey: z.string(),
  title: z.string(),
  type: cardTypeSchema,
  closed: z.boolean(),
});

export type CardSuggestion = z.infer<typeof cardSuggestionSchema>;

/**
 * An asset that matched, offered alongside the cards.
 *
 * A card is a piece of work and an asset is the thing the work is for, and
 * somebody typing `crate` into a card is usually reaching for one or the
 * other without having decided which. Making them choose the right box first is
 * making them answer a question about our data model.
 */
export const assetSuggestionSchema = z.object({
  id: z.string().uuid(),
  assetKey: z.string(),
  name: z.string(),
  categoryName: z.string(),
  status: assetStatusSchema,
});

export type AssetSuggestion = z.infer<typeof assetSuggestionSchema>;

export const cardSearchViewSchema = z.object({
  cards: z.array(cardSuggestionSchema),
  assets: z.array(assetSuggestionSchema),
});

export type CardSearchView = z.infer<typeof cardSearchViewSchema>;

/**
 * Cards and assets in one project matching what somebody is typing.
 *
 * Both, from one box. A card is a piece of work and an asset is the thing the
 * work is for; somebody linking `crate` to a ticket is reaching for one of
 * them and should not have to say which before they start typing.
 *
 * Scoped to a project because that is where a key means something, and because
 * it is the only place a link may point.
 */
export const cardSearchQuery = defineQuery(
  'board.search',
  z.object({
    projectId: z.string().uuid(),
    query: z.string().trim().min(MINIMUM_SEARCH_LENGTH).max(80),
  }),
  cardSearchViewSchema,
);
