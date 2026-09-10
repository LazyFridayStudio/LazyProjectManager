import {
  archiveProjectCommand,
  createProjectCommand,
  projectDetailQuery,
  projectListQuery,
  restoreProjectCommand,
  updateProjectCommand,
  type ProjectDetailView,
  type ProjectListView,
  type ProjectScope,
} from '@lpm/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { z } from 'zod';

import { useApiClient } from '../../components/ApiClientProvider.js';

/**
 * Query keys are namespaced by base URL, as in `use-identity`: switching servers
 * must not show the previous server's projects for even one frame.
 */
const queryKeys = {
  projects: (baseUrl: string) => ['projects', baseUrl] as const,
  list: (baseUrl: string, scope: ProjectScope) => ['projects', baseUrl, scope] as const,
  detail: (baseUrl: string, slug: string) => ['project', baseUrl, slug] as const,
};

export function useProjectList(scope: ProjectScope): UseQueryResult<ProjectListView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: queryKeys.list(baseUrl, scope),
    queryFn: () => client.query(projectListQuery, { scope }),
  });
}

export function useProject(slug: string): UseQueryResult<ProjectDetailView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: queryKeys.detail(baseUrl, slug),
    queryFn: () => client.query(projectDetailQuery, { slug }),
  });
}

export type CreateProjectInput = z.input<typeof createProjectCommand.inputSchema>;
export type UpdateProjectInput = z.input<typeof updateProjectCommand.inputSchema>;

export function useCreateProject(): ReturnType<
  typeof useMutation<unknown, Error, CreateProjectInput>
> {
  const { client } = useApiClient();
  const invalidateProjects = useProjectInvalidation();

  return useMutation({
    mutationFn: (input: CreateProjectInput) => client.command(createProjectCommand, input),
    onSuccess: invalidateProjects,
  });
}

export function useUpdateProject(): ReturnType<
  typeof useMutation<unknown, Error, UpdateProjectInput>
> {
  const { client } = useApiClient();
  const invalidateProjects = useProjectInvalidation();

  return useMutation({
    mutationFn: (input: UpdateProjectInput) => client.command(updateProjectCommand, input),
    onSuccess: invalidateProjects,
  });
}

export interface SetProjectArchivedInput {
  projectId: string;
  archived: boolean;
}

export function useSetProjectArchived(): ReturnType<
  typeof useMutation<unknown, Error, SetProjectArchivedInput>
> {
  const { client } = useApiClient();
  const invalidateProjects = useProjectInvalidation();

  return useMutation({
    mutationFn: ({ projectId, archived }: SetProjectArchivedInput) =>
      client.command(archived ? archiveProjectCommand : restoreProjectCommand, { projectId }),
    onSuccess: invalidateProjects,
  });
}

/**
 * Refetches every project view after a command.
 *
 * Commands return identifiers only, so what changed comes from asking again.
 * Both key families are invalidated because one command can move a project
 * between the launcher and the archive as well as change what its own screen
 * shows.
 *
 * Exported because putting somebody on a project changes the same two things —
 * the settings screen's own list and the count on its tile — and two hooks with
 * their own idea of what to refetch is how one of them ends up stale.
 */
export function useProjectInvalidation(): () => Promise<void> {
  const { baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.projects(baseUrl) });
    await queryClient.invalidateQueries({ queryKey: ['project', baseUrl] });
  };
}
