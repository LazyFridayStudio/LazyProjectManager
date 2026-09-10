import {
  boardViewQuery,
  syncIssuesCommand,
  type BoardView,
  type CommandSuccess,
} from '@lpm/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { z } from 'zod';

import { useApiClient } from '../../components/ApiClientProvider.js';

/**
 * The board for one project.
 *
 * Namespaced by base URL like every other query: switching servers must not show
 * the previous server's board for even one frame.
 */
export function useBoard(slug: string): UseQueryResult<BoardView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: ['board', baseUrl, slug],
    queryFn: () => client.query(boardViewQuery, { slug }),
  });
}

export type SyncIssuesInput = z.input<typeof syncIssuesCommand.inputSchema>;

/**
 * Reads the repository's issues onto this board.
 *
 * Both caches, because a sync can change both: the board draws the cards, and
 * the sidebar counts them.
 */
export function useSyncIssues(): ReturnType<
  typeof useMutation<CommandSuccess, Error, SyncIssuesInput>
> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SyncIssuesInput) => client.command(syncIssuesCommand, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['board', baseUrl] }),
        queryClient.invalidateQueries({ queryKey: ['projects', baseUrl] }),
      ]);
    },
  });
}
