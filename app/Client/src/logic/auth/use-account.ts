import { updateProfileCommand } from '@lpm/shared';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { z } from 'zod';

import { useApiClient } from '../../components/ApiClientProvider.js';
import { uploadFile } from '../files/upload-file.js';

export type UpdateProfileInput = z.input<typeof updateProfileCommand.inputSchema>;

/**
 * Changes your own name, or the letters drawn in place of it.
 *
 * The session is asked again afterwards and nothing else is: your name is drawn
 * from `identity.me` wherever the app draws it at you — the corner of the
 * header, the foot of a project's sidebar — and everywhere it names you to
 * *other* people is a list they will fetch fresh when they next open it.
 */
export function useUpdateProfile(): UseMutationResult<unknown, Error, UpdateProfileInput> {
  const { client } = useApiClient();
  const refresh = useIdentityRefresh();

  return useMutation({
    mutationFn: (input: UpdateProfileInput) => client.command(updateProfileCommand, input),
    onSuccess: refresh,
  });
}

/**
 * Sets your picture, which replaces whatever was there.
 *
 * The same three steps every other upload takes, pointed at nobody: the target
 * names no id, because the only person it can be about is the one asking.
 *
 * The thumbnail is the worker's job and arrives a moment later, so what comes
 * back straight away is the original. Both are the same picture; the second one
 * is smaller.
 */
export function useSetAvatar(): UseMutationResult<string, Error, File> {
  const { client } = useApiClient();
  const refresh = useIdentityRefresh();

  return useMutation({
    mutationFn: (file: File) => uploadFile(client, { kind: 'userAvatar' }, file),
    onSuccess: refresh,
  });
}

/**
 * Asks who you are again.
 *
 * Both families, because a person is drawn from two places: `identity.me` is
 * what the app knows about *you*, and a project's own view carries the people
 * on it — which is you, on every project you are on.
 */
function useIdentityRefresh(): () => Promise<void> {
  const { baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['me', baseUrl] }),
      queryClient.invalidateQueries({ queryKey: ['project', baseUrl] }),
    ]);
  };
}
