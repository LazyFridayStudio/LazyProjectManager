import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../components/ApiClientProvider.js';
import { uploadFile } from '../files/upload-file.js';

/**
 * Sets a project's key art: the wide picture the launcher tile draws.
 *
 * A project has one, so this replaces what was there. The file it points away
 * from stays in the store, because something else may still point at it.
 */
export function useSetKeyArt(
  projectId: string,
  projectSlug: string,
): UseMutationResult<string, Error, File> {
  return useSetPicture('projectKeyArt', projectId, projectSlug);
}

/**
 * Sets a project's logo: the square mark shown wherever it is only named.
 *
 * The same terms as the key art beside it. The sidebar refetches with it: the
 * mark is on every screen of the project, and one that only arrived on the
 * next full page load would look like nothing had happened.
 */
export function useSetProjectLogo(
  projectId: string,
  projectSlug: string,
): UseMutationResult<string, Error, File> {
  return useSetPicture('projectLogo', projectId, projectSlug);
}

function useSetPicture(
  kind: 'projectKeyArt' | 'projectLogo',
  projectId: string,
  projectSlug: string,
): UseMutationResult<string, Error, File> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) => uploadFile(client, { kind, projectId }, file),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project', baseUrl, projectSlug] });
      // Which takes the sidebar's own query with it — it is keyed under the
      // same prefix, and it is what draws the mark on every screen.
      await queryClient.invalidateQueries({ queryKey: ['projects', baseUrl] });
    },
  });
}
