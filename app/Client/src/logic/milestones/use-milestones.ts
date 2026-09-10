import {
  createMilestoneCommand,
  deleteMilestoneCommand,
  milestonePlanQuery,
  updateMilestoneCommand,
  type MilestonePlanView,
} from '@lpm/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { z } from 'zod';

import { useApiClient } from '../../components/ApiClientProvider.js';

/**
 * The release plan: every date the project is held to.
 *
 * Under the `projects` key so realtime invalidation reaches it — closing a card
 * on the board moves the burndown of the milestone it was promised for.
 */
export function useMilestonePlan(slug: string): UseQueryResult<MilestonePlanView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: ['projects', baseUrl, 'milestones', slug],
    queryFn: () => client.query(milestonePlanQuery, { slug }),
  });
}

export type CreateMilestoneInput = z.input<typeof createMilestoneCommand.inputSchema>;
export type UpdateMilestoneInput = z.input<typeof updateMilestoneCommand.inputSchema>;
export type DeleteMilestoneInput = z.input<typeof deleteMilestoneCommand.inputSchema>;

export function useCreateMilestone(): ReturnType<
  typeof useMutation<unknown, Error, CreateMilestoneInput>
> {
  const { client } = useApiClient();
  const invalidate = usePlanInvalidation();

  return useMutation({
    mutationFn: (input: CreateMilestoneInput) => client.command(createMilestoneCommand, input),
    onSuccess: invalidate,
  });
}

export function useUpdateMilestone(): ReturnType<
  typeof useMutation<unknown, Error, UpdateMilestoneInput>
> {
  const { client } = useApiClient();
  const invalidate = usePlanInvalidation();

  return useMutation({
    mutationFn: (input: UpdateMilestoneInput) => client.command(updateMilestoneCommand, input),
    onSuccess: invalidate,
  });
}

export function useDeleteMilestone(): ReturnType<
  typeof useMutation<unknown, Error, DeleteMilestoneInput>
> {
  const { client } = useApiClient();
  const invalidate = usePlanInvalidation();

  return useMutation({
    mutationFn: (input: DeleteMilestoneInput) => client.command(deleteMilestoneCommand, input),
    onSuccess: invalidate,
  });
}

/**
 * Refetches every project view after a milestone command.
 *
 * Not only the plan: a milestone's dates decide what the dashboard's burndown
 * is about, and deleting one unpromises the cards that pointed at it.
 */
function usePlanInvalidation(): () => Promise<void> {
  const { baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['projects', baseUrl] });
  };
}
