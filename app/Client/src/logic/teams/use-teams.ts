import {
  addTeamMemberCommand,
  createTeamCommand,
  deleteTeamCommand,
  removeTeamMemberCommand,
  teamListQuery,
  updateTeamCommand,
  type TeamListView,
} from '@lpm/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { z } from 'zod';

import { useApiClient } from '../../components/ApiClientProvider.js';

export type CreateTeamInput = z.input<typeof createTeamCommand.inputSchema>;
export type UpdateTeamInput = z.input<typeof updateTeamCommand.inputSchema>;
export type DeleteTeamInput = z.input<typeof deleteTeamCommand.inputSchema>;
export type TeamMemberInput = z.input<typeof addTeamMemberCommand.inputSchema>;

/**
 * Every team on the install.
 *
 * One request rather than a page at a time: a studio of a thousand people has
 * tens of teams, and the screen is a grid of all of them.
 */
export function useTeams(): UseQueryResult<TeamListView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: ['teams', baseUrl],
    queryFn: () => client.query(teamListQuery, {}),
  });
}

export function useCreateTeam(): ReturnType<
  typeof useMutation<{ id?: string }, Error, CreateTeamInput>
> {
  const { client } = useApiClient();
  const refresh = useTeamRefresh();

  return useMutation({
    mutationFn: (input: CreateTeamInput) => client.command(createTeamCommand, input),
    onSuccess: refresh,
  });
}

export function useUpdateTeam(): ReturnType<typeof useMutation<unknown, Error, UpdateTeamInput>> {
  const { client } = useApiClient();
  const refresh = useTeamRefresh();

  return useMutation({
    mutationFn: (input: UpdateTeamInput) => client.command(updateTeamCommand, input),
    onSuccess: refresh,
  });
}

export function useDeleteTeam(): ReturnType<typeof useMutation<unknown, Error, DeleteTeamInput>> {
  const { client } = useApiClient();
  const refresh = useTeamRefresh();

  return useMutation({
    mutationFn: (input: DeleteTeamInput) => client.command(deleteTeamCommand, input),
    onSuccess: refresh,
  });
}

export function useAddTeamMember(): ReturnType<
  typeof useMutation<unknown, Error, TeamMemberInput>
> {
  const { client } = useApiClient();
  const refresh = useTeamRefresh();

  return useMutation({
    mutationFn: (input: TeamMemberInput) => client.command(addTeamMemberCommand, input),
    onSuccess: refresh,
  });
}

export function useRemoveTeamMember(): ReturnType<
  typeof useMutation<unknown, Error, TeamMemberInput>
> {
  const { client } = useApiClient();
  const refresh = useTeamRefresh();

  return useMutation({
    mutationFn: (input: TeamMemberInput) => client.command(removeTeamMemberCommand, input),
    onSuccess: refresh,
  });
}

/**
 * Refetches the teams and the people together.
 *
 * Putting somebody in a team changes the team's count and the person's row, and
 * the two are on screen at the same time.
 */
function useTeamRefresh(): () => Promise<void> {
  const { baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['teams', baseUrl] }),
      queryClient.invalidateQueries({ queryKey: ['people', baseUrl] }),
    ]);
  };
}
