import {
  cardDetailQuery,
  createCardCommand,
  deleteCardCommand,
  moveCardCommand,
  updateCardCommand,
  type BoardView,
  type CardDetailView,
} from '@lpm/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { z } from 'zod';

import { useApiClient } from '../../components/ApiClientProvider.js';
import type { CardMove } from './card-drag.js';

export type CreateCardInput = z.input<typeof createCardCommand.inputSchema>;
export type UpdateCardInput = z.input<typeof updateCardCommand.inputSchema>;

const boardKey = (baseUrl: string, slug: string): readonly unknown[] => ['board', baseUrl, slug];
const cardKey = (baseUrl: string, cardId: string): readonly unknown[] => ['card', baseUrl, cardId];

export function useCardDetail(cardId: string | null): UseQueryResult<CardDetailView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: cardKey(baseUrl, cardId ?? ''),
    queryFn: () => client.query(cardDetailQuery, { cardId: cardId ?? '' }),
    enabled: cardId !== null,
  });
}

export function useCreateCard(
  projectSlug: string,
): ReturnType<typeof useMutation<unknown, Error, CreateCardInput>> {
  const { client } = useApiClient();
  const refresh = useBoardRefresh(projectSlug);

  return useMutation({
    mutationFn: (input: CreateCardInput) => client.command(createCardCommand, input),
    onSuccess: refresh,
  });
}

export function useUpdateCard(
  projectSlug: string,
): ReturnType<typeof useMutation<unknown, Error, UpdateCardInput>> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();
  const refresh = useBoardRefresh(projectSlug);

  return useMutation({
    mutationFn: (input: UpdateCardInput) => client.command(updateCardCommand, input),
    onSuccess: async (_result, input) => {
      await queryClient.invalidateQueries({ queryKey: cardKey(baseUrl, input.cardId) });
      await refresh();
    },
  });
}

/**
 * Takes a card off the board.
 *
 * The card's own cached copy is dropped rather than invalidated: invalidating
 * asks for it again, and the only answer left to that question is a 404 that
 * would land as an error on a panel already closing.
 */
export function useDeleteCard(
  projectSlug: string,
): ReturnType<typeof useMutation<unknown, Error, { cardId: string }>> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();
  const refresh = useBoardRefresh(projectSlug);

  return useMutation({
    mutationFn: (input: { cardId: string }) => client.command(deleteCardCommand, input),
    onSuccess: async (_result, input) => {
      queryClient.removeQueries({ queryKey: cardKey(baseUrl, input.cardId) });
      await refresh();
    },
  });
}

/**
 * Reads and rewrites the board on screen.
 *
 * The cached board is what the drag moves. Rewriting it as the pointer travels
 * is what makes the other cards step aside, rather than everything jumping into
 * place after the drop.
 */
export interface BoardPreview {
  read: () => BoardView | undefined;
  write: (view: BoardView) => void;
}

export function useBoardPreview(projectSlug: string): BoardPreview {
  const { baseUrl } = useApiClient();
  const queryClient = useQueryClient();
  const key = boardKey(baseUrl, projectSlug);

  return {
    read: () => queryClient.getQueryData<BoardView>(key),
    write: (view: BoardView) => {
      queryClient.setQueryData<BoardView>(key, view);
    },
  };
}

/**
 * What a finished drag asks for: the move, and the board to put back if the
 * server refuses it.
 *
 * The board before the drag started, not the one currently on screen — by the
 * time this is sent the screen already shows the card in its new home, and
 * rolling back to that would leave it there.
 */
export interface CommittedMove {
  readonly move: CardMove;
  readonly revertTo: BoardView | undefined;
}

/**
 * Sends a move the screen has already made.
 *
 * The board was rewritten while the card was being dragged, so there is nothing
 * optimistic left to do here — only to put the previous board back if the server
 * refuses, most often because a list is at its work-in-progress limit.
 */
export function useMoveCard(
  projectSlug: string,
): ReturnType<typeof useMutation<unknown, Error, CommittedMove>> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();
  const key = boardKey(baseUrl, projectSlug);

  return useMutation({
    mutationFn: ({ move }: CommittedMove) =>
      client.command(moveCardCommand, {
        cardId: move.cardId,
        toListId: move.toListId,
        beforeCardId: move.beforeCardId,
        afterCardId: move.afterCardId,
      }),

    // Otherwise a refetch already in flight lands on top of the drag and puts
    // the card back where it started.
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: key });
    },

    onError: (_error, committed) => {
      if (committed.revertTo !== undefined) {
        queryClient.setQueryData<BoardView>(key, committed.revertTo);
      }
    },

    // Whether it worked or not, the server is the authority on where the card
    // ended up — its position is arithmetic nobody here should be repeating.
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * Sends a card to another list, from the card's own panel.
 *
 * Simpler than the board's drag, which carries an optimistic board to put back
 * if the server refuses. Here there is nothing to put back: the panel shows
 * where the card is once the server has said, and the board behind it refetches.
 */
export function useMoveCardToList(
  projectSlug: string,
  cardId: string,
): ReturnType<typeof useMutation<unknown, Error, { toListId: string }>> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ toListId }: { toListId: string }) =>
      client.command(moveCardCommand, { cardId, toListId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: cardKey(baseUrl, cardId) });
      await queryClient.invalidateQueries({ queryKey: boardKey(baseUrl, projectSlug) });
    },
  });
}

function useBoardRefresh(projectSlug: string): () => Promise<void> {
  const { baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return async () => {
    await queryClient.invalidateQueries({ queryKey: boardKey(baseUrl, projectSlug) });
  };
}
