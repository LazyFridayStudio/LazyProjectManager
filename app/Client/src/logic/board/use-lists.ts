import {
  archiveListCommand,
  createListCommand,
  moveListCommand,
  updateListCommand,
  type BoardView,
} from '@lpm/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';

import { useApiClient } from '../../components/ApiClientProvider.js';

export type CreateListInput = z.input<typeof createListCommand.inputSchema>;
export type UpdateListInput = z.input<typeof updateListCommand.inputSchema>;
export type ArchiveListInput = z.input<typeof archiveListCommand.inputSchema>;

export function useCreateList(
  projectSlug: string,
): ReturnType<typeof useMutation<unknown, Error, CreateListInput>> {
  const { client } = useApiClient();
  const refresh = useBoardRefresh(projectSlug);

  return useMutation({
    mutationFn: (input: CreateListInput) => client.command(createListCommand, input),
    onSuccess: refresh,
  });
}

export function useUpdateList(
  projectSlug: string,
): ReturnType<typeof useMutation<unknown, Error, UpdateListInput>> {
  const { client } = useApiClient();
  const refresh = useBoardRefresh(projectSlug);

  return useMutation({
    mutationFn: (input: UpdateListInput) => client.command(updateListCommand, input),
    onSuccess: refresh,
  });
}

export function useArchiveList(
  projectSlug: string,
): ReturnType<typeof useMutation<unknown, Error, ArchiveListInput>> {
  const { client } = useApiClient();
  const refresh = useBoardRefresh(projectSlug);

  return useMutation({
    mutationFn: (input: ArchiveListInput) => client.command(archiveListCommand, input),
    onSuccess: refresh,
  });
}

/**
 * What a finished column drag asks for: where the list goes, and the board to
 * put back if the server refuses it.
 *
 * The board from before the drag, not the one on screen — by the time this is
 * sent the columns are already drawn in their new order, and rolling back to
 * that would leave them there.
 */
export interface CommittedListMove {
  readonly listId: string;
  readonly beforeListId: string | null;
  readonly afterListId: string | null;
  readonly revertTo: BoardView | undefined;
}

/**
 * Sends a reorder the board has already drawn.
 *
 * Optimistic, unlike the other three: a column arriving where it was dropped is
 * the whole of what a drag promises, and a round trip is long enough to see the
 * board spring back and jump forward again.
 */
export function useMoveList(
  projectSlug: string,
): ReturnType<typeof useMutation<unknown, Error, CommittedListMove>> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();
  const key = ['board', baseUrl, projectSlug];

  return useMutation({
    mutationFn: (move: CommittedListMove) =>
      client.command(moveListCommand, {
        listId: move.listId,
        beforeListId: move.beforeListId,
        afterListId: move.afterListId,
      }),

    // Otherwise a refetch already in flight lands on top of the drag and puts
    // the column back where it started.
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: key });
    },

    onError: (_error, move) => {
      if (move.revertTo !== undefined) {
        queryClient.setQueryData<BoardView>(key, move.revertTo);
      }
    },

    // Whether it worked or not, the server is the authority on where the list
    // ended up — its position is arithmetic nobody here should be repeating.
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * Refetches the board after a list changes.
 *
 * Not optimistic, unlike a card move: adding or archiving a list changes what
 * every card on the board is sitting in, and guessing at that is far more likely
 * to be wrong than it is to save a frame.
 */
function useBoardRefresh(projectSlug: string): () => Promise<void> {
  const { baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['board', baseUrl, projectSlug] });
  };
}
