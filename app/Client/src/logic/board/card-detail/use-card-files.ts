import { detachFileCommand } from '@lpm/shared';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../components/ApiClientProvider.js';
import { uploadFile } from '../../files/upload-file.js';

export interface CardFileActions {
  readonly upload: UseMutationResult<unknown, Error, File>;
  readonly detach: UseMutationResult<unknown, Error, { attachmentId: string }>;
}

/**
 * Putting a file on a card, in the three steps it actually takes.
 *
 * Ask the server where to put it, PUT the bytes straight at the store, then tell
 * the server it arrived. The middle step never touches the API, which is the
 * whole reason for signing a URL rather than posting the file to it — a
 * forty-megabyte source file would otherwise cross the network twice and sit in
 * Node's memory on the way past.
 */
export function useCardFiles(
  cardId: string,
  projectSlug: string,
  onError?: (message: string) => void,
): CardFileActions {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['card', baseUrl, cardId] });
    await queryClient.invalidateQueries({ queryKey: ['board', baseUrl, projectSlug] });
  };

  return {
    upload: useMutation({
      mutationFn: (file: File) => uploadFile(client, { kind: 'cardAttachment', cardId }, file),
      onSuccess: refresh,
      onError: (error: Error) => {
        onError?.(error.message);
      },
    }),

    detach: useMutation({
      mutationFn: ({ attachmentId }: { attachmentId: string }) =>
        client.command(detachFileCommand, { attachmentId }),
      onSuccess: refresh,
    }),
  };
}
