import {
  addProjectMemberCommand,
  addProjectTeamCommand,
  projectCandidatesQuery,
  removeProjectMemberCommand,
  removeProjectTeamCommand,
  type ProjectCandidatesView,
} from '@lpm/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { z } from 'zod';

import { useApiClient } from '../../components/ApiClientProvider.js';
import { useProjectInvalidation } from './use-projects.js';

export type AddProjectMemberInput = z.input<typeof addProjectMemberCommand.inputSchema>;
export type RemoveProjectMemberInput = z.input<typeof removeProjectMemberCommand.inputSchema>;
export type AddProjectTeamInput = z.input<typeof addProjectTeamCommand.inputSchema>;
export type RemoveProjectTeamInput = z.input<typeof removeProjectTeamCommand.inputSchema>;

const candidateKey = (baseUrl: string, projectId: string, search: string) =>
  ['project-candidates', baseUrl, projectId, search] as const;

/**
 * Who and what is left to put on this project, narrowed by what has been typed.
 *
 * Asked of the server on every keystroke rather than filtered here, because a
 * thousand people minus the eight already on the project is still a thousand
 * people to send. `enabled` is what keeps it off the screens of somebody who
 * may not staff the project: the query would refuse them, and a panel drawing
 * an error where it has no controls is a panel about nothing.
 */
export function useProjectCandidates(
  projectId: string,
  search: string,
  enabled: boolean,
): UseQueryResult<ProjectCandidatesView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: candidateKey(baseUrl, projectId, search),
    queryFn: () => client.query(projectCandidatesQuery, { projectId, search }),
    enabled,
  });
}

export function useAddProjectMember(): ReturnType<
  typeof useMutation<unknown, Error, AddProjectMemberInput>
> {
  const { client } = useApiClient();
  const refresh = useMembershipRefresh();

  return useMutation({
    mutationFn: (input: AddProjectMemberInput) => client.command(addProjectMemberCommand, input),
    onSuccess: refresh,
  });
}

export function useRemoveProjectMember(): ReturnType<
  typeof useMutation<unknown, Error, RemoveProjectMemberInput>
> {
  const { client } = useApiClient();
  const refresh = useMembershipRefresh();

  return useMutation({
    mutationFn: (input: RemoveProjectMemberInput) =>
      client.command(removeProjectMemberCommand, input),
    onSuccess: refresh,
  });
}

export function useAddProjectTeam(): ReturnType<
  typeof useMutation<unknown, Error, AddProjectTeamInput>
> {
  const { client } = useApiClient();
  const refresh = useMembershipRefresh();

  return useMutation({
    mutationFn: (input: AddProjectTeamInput) => client.command(addProjectTeamCommand, input),
    onSuccess: refresh,
  });
}

export function useRemoveProjectTeam(): ReturnType<
  typeof useMutation<unknown, Error, RemoveProjectTeamInput>
> {
  const { client } = useApiClient();
  const refresh = useMembershipRefresh();

  return useMutation({
    mutationFn: (input: RemoveProjectTeamInput) => client.command(removeProjectTeamCommand, input),
    onSuccess: refresh,
  });
}

/**
 * Refetches the project and the pickers together.
 *
 * Somebody added to the project is somebody the picker must stop offering, and
 * the two lists are on screen at the same time — so a refresh that took only
 * the first would leave a name in the picker that adding again would do
 * nothing to.
 */
function useMembershipRefresh(): () => Promise<void> {
  const { baseUrl } = useApiClient();
  const queryClient = useQueryClient();
  const invalidateProjects = useProjectInvalidation();

  return async () => {
    await Promise.all([
      invalidateProjects(),
      queryClient.invalidateQueries({ queryKey: ['project-candidates', baseUrl] }),
    ]);
  };
}
