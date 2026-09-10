import {
  buildsQuery,
  deleteReleaseCommand,
  recordReleaseCommand,
  syncReleasesCommand,
  updateReleaseCommand,
  type BuildsView,
  type CommandSuccess,
} from '@lpm/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { z } from 'zod';

import { useApiClient } from '../../components/ApiClientProvider.js';

/**
 * What the project has shipped.
 *
 * Under the `projects` key so realtime invalidation reaches it: somebody else
 * recording a release should put it on this page without a reload.
 */
export function useBuilds(slug: string): UseQueryResult<BuildsView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: ['projects', baseUrl, 'builds', slug],
    queryFn: () => client.query(buildsQuery, { slug }),
  });
}

export type RecordReleaseInput = z.input<typeof recordReleaseCommand.inputSchema>;
export type UpdateReleaseInput = z.input<typeof updateReleaseCommand.inputSchema>;
export type DeleteReleaseInput = z.input<typeof deleteReleaseCommand.inputSchema>;
export type SyncReleasesInput = z.input<typeof syncReleasesCommand.inputSchema>;

type ReleaseMutation<TInput> = ReturnType<typeof useMutation<CommandSuccess, Error, TInput>>;

export function useRecordRelease(): ReleaseMutation<RecordReleaseInput> {
  return useReleaseMutation((client, input: RecordReleaseInput) =>
    client.command(recordReleaseCommand, input),
  );
}

export function useUpdateRelease(): ReleaseMutation<UpdateReleaseInput> {
  return useReleaseMutation((client, input: UpdateReleaseInput) =>
    client.command(updateReleaseCommand, input),
  );
}

export function useDeleteRelease(): ReleaseMutation<DeleteReleaseInput> {
  return useReleaseMutation((client, input: DeleteReleaseInput) =>
    client.command(deleteReleaseCommand, input),
  );
}

/**
 * Reads the connected repository's releases in.
 *
 * Slower than the others, because somebody else's server is on the other end.
 * The button says so while it waits.
 */
export function useSyncReleases(): ReleaseMutation<SyncReleasesInput> {
  return useReleaseMutation((client, input: SyncReleasesInput) =>
    client.command(syncReleasesCommand, input),
  );
}

type ApiClient = ReturnType<typeof useApiClient>['client'];

/**
 * Every release command asks for the page again.
 *
 * Commands answer with an identifier and nothing else, so what changed comes
 * from asking again — and which release is now the latest is a question only
 * the server's ordering can answer.
 */
function useReleaseMutation<TInput>(
  send: (client: ApiClient, input: TInput) => Promise<CommandSuccess>,
): ReleaseMutation<TInput> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: TInput) => send(client, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects', baseUrl] });
    },
  });
}
