import {
  cardSearchQuery,
  MINIMUM_SEARCH_LENGTH,
  type AssetSuggestion,
  type CardSuggestion,
} from '@lpm/shared';
import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '../../../components/ApiClientProvider.js';

export interface Suggestions {
  readonly cards: readonly CardSuggestion[];
  readonly assets: readonly AssetSuggestion[];
}

const NOTHING: Suggestions = { cards: [], assets: [] };

/**
 * Cards and assets matching what somebody is typing into the link field.
 *
 * Both, because a card is a piece of work and an asset is the thing the work is
 * for, and somebody typing `crate` is reaching for one of them without
 * having decided which.
 *
 * Nothing runs until there are enough characters to mean something: two
 * characters of a key match most of the board, so the suggestions would be noise
 * and the query would fire on every keystroke of a word nobody has finished.
 */
export function useSuggestions(projectId: string, query: string): Suggestions {
  const { client, baseUrl } = useApiClient();
  const trimmed = query.trim();
  const isLongEnough = trimmed.length >= MINIMUM_SEARCH_LENGTH;

  const found = useQuery({
    queryKey: ['search', baseUrl, projectId, trimmed],
    queryFn: () => client.query(cardSearchQuery, { projectId, query: trimmed }),
    enabled: isLongEnough,
    // The board changes far more slowly than somebody types, and backspacing a
    // character should show the previous list again rather than refetch it.
    staleTime: 30_000,
  });

  return isLongEnough ? (found.data ?? NOTHING) : NOTHING;
}
