import {
  createPermissionGroupCommand,
  deletePermissionGroupCommand,
  permissionsQuery,
  renamePermissionGroupCommand,
  setPermissionRuleCommand,
  orderTeamPermissionGroupsCommand,
  setTeamPermissionGroupCommand,
  type CommandSuccess,
  type PermissionsView,
} from '@lpm/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { z } from 'zod';

import { useApiClient } from '../../components/ApiClientProvider.js';

/** Every group, what each says, and who holds it. */
export function usePermissions(): UseQueryResult<PermissionsView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: ['permissions', baseUrl],
    queryFn: () => client.query(permissionsQuery, {}),
  });
}

type Mutation<TInput> = ReturnType<typeof useMutation<CommandSuccess, Error, TInput>>;

export type CreateGroupInput = z.input<typeof createPermissionGroupCommand.inputSchema>;
export type RenameGroupInput = z.input<typeof renamePermissionGroupCommand.inputSchema>;
export type DeleteGroupInput = z.input<typeof deletePermissionGroupCommand.inputSchema>;
export type SetRuleInput = z.input<typeof setPermissionRuleCommand.inputSchema>;
export type SetTeamGroupInput = z.input<typeof setTeamPermissionGroupCommand.inputSchema>;
export type OrderTeamGroupsInput = z.input<typeof orderTeamPermissionGroupsCommand.inputSchema>;

export function useCreateGroup(): Mutation<CreateGroupInput> {
  return usePermissionMutation((client, input: CreateGroupInput) =>
    client.command(createPermissionGroupCommand, input),
  );
}

export function useRenameGroup(): Mutation<RenameGroupInput> {
  return usePermissionMutation((client, input: RenameGroupInput) =>
    client.command(renamePermissionGroupCommand, input),
  );
}

export function useDeleteGroup(): Mutation<DeleteGroupInput> {
  return usePermissionMutation((client, input: DeleteGroupInput) =>
    client.command(deletePermissionGroupCommand, input),
  );
}

export function useSetRule(): Mutation<SetRuleInput> {
  return usePermissionMutation((client, input: SetRuleInput) =>
    client.command(setPermissionRuleCommand, input),
  );
}

export function useSetTeamGroup(): Mutation<SetTeamGroupInput> {
  return usePermissionMutation((client, input: SetTeamGroupInput) =>
    client.command(setTeamPermissionGroupCommand, input),
  );
}

/** Puts a team's permissions in the order they were dragged into. */
export function useOrderTeamGroups(): Mutation<OrderTeamGroupsInput> {
  return usePermissionMutation((client, input: OrderTeamGroupsInput) =>
    client.command(orderTeamPermissionGroupsCommand, input),
  );
}

type ApiClient = ReturnType<typeof useApiClient>['client'];

/**
 * Every permission command asks for the page again.
 *
 * Commands answer with an identifier and nothing else, and a rule changes what
 * a group says about an action the screen is already drawing — so what changed
 * comes from asking rather than from guessing.
 */
function usePermissionMutation<TInput>(
  send: (client: ApiClient, input: TInput) => Promise<CommandSuccess>,
): Mutation<TInput> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: TInput) => send(client, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['permissions', baseUrl] });
    },
  });
}
