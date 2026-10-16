import {
  addAssetChecklistItemCommand,
  addAssetTabBlockCommand,
  addAssetTabCommand,
  applyAssetTemplateCommand,
  assetTemplatesQuery,
  createAssetTemplateCommand,
  deleteAssetTabCommand,
  deleteAssetTemplateCommand,
  moveAssetTabBlockCommand,
  moveAssetTabCommand,
  removeAssetChecklistItemCommand,
  removeAssetTabBlockCommand,
  updateAssetChecklistItemCommand,
  updateAssetTabBlockCommand,
  updateAssetTabCommand,
  updateAssetTemplateCommand,
  type AssetTemplatesView,
  type CommandDefinition,
  type CommandSuccess,
} from '@lpm/shared';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { z } from 'zod';

import { useApiClient } from '../../components/ApiClientProvider.js';
import { useAssetAndTileRefresh } from './use-assets.js';

/**
 * Sends one command about something on an asset, and refreshes the asset and
 * the library behind it.
 *
 * Both, every time: the tile counts the tabs and how many are done, so ticking
 * Rig off in the panel has to move `2/5` to `3/5` behind it, or the library
 * disagrees with the thing open on top of it. Not the sidebar, which counts
 * assets and categories and nothing a tab changes.
 */
function useAssetCommand<TDefinition extends CommandDefinition>(
  definition: TDefinition,
  projectSlug: string,
  assetId: string,
): UseMutationResult<CommandSuccess, Error, z.input<TDefinition['inputSchema']>> {
  const { client } = useApiClient();
  const refresh = useAssetAndTileRefresh(projectSlug, assetId);

  return useMutation({
    mutationFn: (input: z.input<TDefinition['inputSchema']>) => client.command(definition, input),
    onSuccess: refresh,
  });
}

export const useAddAssetTab = (projectSlug: string, assetId: string) =>
  useAssetCommand(addAssetTabCommand, projectSlug, assetId);

export const useUpdateAssetTab = (projectSlug: string, assetId: string) =>
  useAssetCommand(updateAssetTabCommand, projectSlug, assetId);

export const useMoveAssetTab = (projectSlug: string, assetId: string) =>
  useAssetCommand(moveAssetTabCommand, projectSlug, assetId);

export const useDeleteAssetTab = (projectSlug: string, assetId: string) =>
  useAssetCommand(deleteAssetTabCommand, projectSlug, assetId);

export const useAddAssetTabBlock = (projectSlug: string, assetId: string) =>
  useAssetCommand(addAssetTabBlockCommand, projectSlug, assetId);

export const useUpdateAssetTabBlock = (projectSlug: string, assetId: string) =>
  useAssetCommand(updateAssetTabBlockCommand, projectSlug, assetId);

export const useMoveAssetTabBlock = (projectSlug: string, assetId: string) =>
  useAssetCommand(moveAssetTabBlockCommand, projectSlug, assetId);

export const useRemoveAssetTabBlock = (projectSlug: string, assetId: string) =>
  useAssetCommand(removeAssetTabBlockCommand, projectSlug, assetId);

export const useAddAssetChecklistItem = (projectSlug: string, assetId: string) =>
  useAssetCommand(addAssetChecklistItemCommand, projectSlug, assetId);

export const useUpdateAssetChecklistItem = (projectSlug: string, assetId: string) =>
  useAssetCommand(updateAssetChecklistItemCommand, projectSlug, assetId);

export const useRemoveAssetChecklistItem = (projectSlug: string, assetId: string) =>
  useAssetCommand(removeAssetChecklistItemCommand, projectSlug, assetId);

export const useApplyAssetTemplate = (projectSlug: string, assetId: string) =>
  useAssetCommand(applyAssetTemplateCommand, projectSlug, assetId);

const templatesKey = (baseUrl: string, projectId: string) =>
  ['asset-templates', baseUrl, projectId] as const;

/** A project's templates, for every picker that offers them. */
export function useAssetTemplates(projectId: string): UseQueryResult<AssetTemplatesView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: templatesKey(baseUrl, projectId),
    queryFn: () => client.query(assetTemplatesQuery, { projectId }),
  });
}

/**
 * Keeps, renames or deletes one of the project's templates.
 *
 * The library is refetched as well as the list, because deleting one empties
 * the category that offered it.
 */
function useTemplateCommand<TDefinition extends CommandDefinition>(
  definition: TDefinition,
  projectId: string,
): UseMutationResult<CommandSuccess, Error, z.input<TDefinition['inputSchema']>> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: z.input<TDefinition['inputSchema']>) => client.command(definition, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: templatesKey(baseUrl, projectId) });
      await queryClient.invalidateQueries({ queryKey: ['assets', baseUrl] });
    },
  });
}

export const useCreateAssetTemplate = (projectId: string) =>
  useTemplateCommand(createAssetTemplateCommand, projectId);

export const useUpdateAssetTemplate = (projectId: string) =>
  useTemplateCommand(updateAssetTemplateCommand, projectId);

export const useDeleteAssetTemplate = (projectId: string) =>
  useTemplateCommand(deleteAssetTemplateCommand, projectId);
