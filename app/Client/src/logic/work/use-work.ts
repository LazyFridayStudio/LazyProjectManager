import { logWorkCommand, removeWorkCommand } from '@lpm/shared';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../components/ApiClientProvider.js';

/** What an entry is about. Exactly one, as the command insists. */
export type WorkedOnWhat = { readonly cardId: string } | { readonly assetId: string };

export interface LoggedWork {
  readonly minutes: number;
  readonly workedOn: string;
  readonly note?: string | undefined;
}

/**
 * Records hours against a card or an asset.
 *
 * The panel that shows the total is the same query that carries the card, so
 * the whole card is refetched rather than a total being patched in one place
 * and left stale in another.
 */
export function useLogWork(
  what: WorkedOnWhat,
  onLogged: () => void,
): UseMutationResult<unknown, Error, LoggedWork> {
  const { client } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (work: LoggedWork) => client.command(logWorkCommand, { ...what, ...work }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      onLogged();
    },
  });
}

/** Takes one of your own entries back off. */
export function useRemoveWork(): UseMutationResult<unknown, Error, string> {
  const { client } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entryId: string) => client.command(removeWorkCommand, { entryId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });
}
