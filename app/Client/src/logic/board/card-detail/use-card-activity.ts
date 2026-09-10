import {
  addSubtaskCommand,
  commentCommand,
  linkCardCommand,
  putUnderLegendCommand,
  removeSubtaskCommand,
  setLegendCommand,
  unlinkCardCommand,
  updateSubtaskCommand,
} from '@lpm/shared';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { z } from 'zod';

import { useApiClient } from '../../../components/ApiClientProvider.js';

/**
 * Everything a card's panel can write, other than its own fields.
 *
 * One hook rather than six, because every one of them ends the same way: refetch
 * this card, and refetch the board it is on in case what changed shows on the
 * chip.
 */
export interface CardActivityActions {
  readonly addSubtask: UseMutationResult<unknown, Error, { title: string }>;
  readonly updateSubtask: UseMutationResult<
    unknown,
    Error,
    z.input<typeof updateSubtaskCommand.inputSchema>
  >;
  readonly removeSubtask: UseMutationResult<unknown, Error, { subtaskId: string }>;
  readonly comment: UseMutationResult<unknown, Error, { body: string }>;
  readonly link: UseMutationResult<unknown, Error, z.input<typeof linkCardCommand.inputSchema>>;
  readonly unlink: UseMutationResult<unknown, Error, { linkId: string }>;
  readonly setLegend: UseMutationResult<unknown, Error, { isLegend: boolean }>;
  readonly putUnderLegend: UseMutationResult<
    unknown,
    Error,
    z.input<typeof putUnderLegendCommand.inputSchema>
  >;
}

export function useCardActivity(cardId: string, projectSlug: string): CardActivityActions {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['card', baseUrl, cardId] });
    await queryClient.invalidateQueries({ queryKey: ['board', baseUrl, projectSlug] });
  };

  return {
    addSubtask: useMutation({
      mutationFn: ({ title }: { title: string }) =>
        client.command(addSubtaskCommand, { cardId, title }),
      onSuccess: refresh,
    }),

    updateSubtask: useMutation({
      mutationFn: (input: z.input<typeof updateSubtaskCommand.inputSchema>) =>
        client.command(updateSubtaskCommand, input),
      onSuccess: refresh,
    }),

    removeSubtask: useMutation({
      mutationFn: ({ subtaskId }: { subtaskId: string }) =>
        client.command(removeSubtaskCommand, { subtaskId }),
      onSuccess: refresh,
    }),

    comment: useMutation({
      mutationFn: ({ body }: { body: string }) => client.command(commentCommand, { cardId, body }),
      onSuccess: refresh,
    }),

    link: useMutation({
      mutationFn: (input: z.input<typeof linkCardCommand.inputSchema>) =>
        client.command(linkCardCommand, input),
      onSuccess: refresh,
    }),

    unlink: useMutation({
      mutationFn: ({ linkId }: { linkId: string }) => client.command(unlinkCardCommand, { linkId }),
      onSuccess: refresh,
    }),

    setLegend: useMutation({
      mutationFn: ({ isLegend }: { isLegend: boolean }) =>
        client.command(setLegendCommand, { cardId, isLegend }),
      onSuccess: refresh,
    }),

    putUnderLegend: useMutation({
      mutationFn: (input: z.input<typeof putUnderLegendCommand.inputSchema>) =>
        client.command(putUnderLegendCommand, input),
      onSuccess: refresh,
    }),
  };
}
