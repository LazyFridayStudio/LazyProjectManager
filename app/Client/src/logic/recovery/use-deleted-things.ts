import {
  deletedThingsQuery,
  purgeDeletedThingCommand,
  restoreDeletedThingCommand,
  type CommandSuccess,
  type DeletedThingsView,
} from '@lpm/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { z } from 'zod';

import { useApiClient } from '../../components/ApiClientProvider.js';

/** What has been deleted and can still be put back, soonest to expire first. */
export function useDeletedThings(): UseQueryResult<DeletedThingsView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: ['deletedThings', baseUrl],
    queryFn: () => client.query(deletedThingsQuery, {}),
  });
}

type Mutation<TInput> = ReturnType<typeof useMutation<CommandSuccess, Error, TInput>>;

export type RestoreInput = z.input<typeof restoreDeletedThingCommand.inputSchema>;
export type PurgeInput = z.input<typeof purgeDeletedThingCommand.inputSchema>;

export function useRestoreDeletedThing(): Mutation<RestoreInput> {
  return useBinMutation((client, input: RestoreInput) =>
    client.command(restoreDeletedThingCommand, input),
  );
}

export function usePurgeDeletedThing(): Mutation<PurgeInput> {
  return useBinMutation((client, input: PurgeInput) =>
    client.command(purgeDeletedThingCommand, input),
  );
}

type ApiClient = ReturnType<typeof useApiClient>['client'];

/**
 * Both commands empty the row out of the bin, so both ask for the list again.
 *
 * Everything else on the install is asked for too. A restored team is a team
 * again, a restored document is back in its project's sidebar, and there is no
 * telling from here which screen somebody will look at next.
 */
function useBinMutation<TInput>(
  send: (client: ApiClient, input: TInput) => Promise<CommandSuccess>,
): Mutation<TInput> {
  const { client } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: TInput) => send(client, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });
}
