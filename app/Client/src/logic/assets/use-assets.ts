import {
  addAssetSubtaskCommand,
  moveAssetCategoryCommand,
  moveAssetCommand,
  assetDetailQuery,
  linkAssetCommand,
  unlinkAssetCommand,
  assetLibraryQuery,
  createAssetCategoryCommand,
  createAssetCommand,
  deleteAssetCategoryCommand,
  deleteAssetCommand,
  linkAssetFileCommand,
  moveAssetReferenceCommand,
  promoteAssetReferenceCommand,
  removeAssetFileCommand,
  removeAssetReferenceCommand,
  removeAssetSubtaskCommand,
  tagAssetCommand,
  untagAssetCommand,
  updateAssetCategoryCommand,
  updateAssetCommand,
  updateAssetSubtaskCommand,
  type AssetDetailView,
  type AssetLibraryView,
} from '@lpm/shared';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { z } from 'zod';

import { useApiClient } from '../../components/ApiClientProvider.js';
import type { AssetMove } from './asset-drag.js';
import type { CategoryMove } from './category-drag.js';
import { toQueryParams, NO_FILTERS, type AssetFilters } from './asset-filters.js';
import { uploadFile } from '../files/upload-file.js';

/**
 * Namespaced by base URL, as everywhere: switching servers must not show the
 * previous server's library for even one frame.
 *
 * The filter is part of the key, so narrowing is a different answer rather than
 * a refetch of the same one — and going back to a filter you had a moment ago
 * is instant.
 */
const libraryKey = (baseUrl: string, slug: string, filters: AssetFilters) =>
  ['assets', baseUrl, slug, filters.search, filters.tags, filters.statuses] as const;

/**
 * The sidebar's copy of the same categories.
 *
 * It always carried their counts, and it draws the whole tree now — so anything
 * that changes a category changes two screens, and refetching only the library
 * leaves the nav beside it showing what was there a moment ago.
 */
const workspaceKey = (baseUrl: string, slug: string) =>
  ['projects', baseUrl, 'workspace', slug] as const;

export function useAssetLibrary(
  slug: string,
  filters: AssetFilters = NO_FILTERS,
): UseQueryResult<AssetLibraryView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: libraryKey(baseUrl, slug, filters),
    queryFn: () => client.query(assetLibraryQuery, { slug, ...toQueryParams(filters) }),
    // The previous answer stays on screen while the next one is fetched.
    // Without it, typing into the search box empties the library between every
    // keystroke, which reads as the search having found nothing.
    placeholderData: keepPreviousData,
  });
}

/**
 * What a finished drag sends, and what to put back if the server refuses it.
 *
 * The library as it was before the drag started, not the one on screen — by the
 * time this is sent the screen already shows the asset in its new place, and
 * rolling back to that would leave it there.
 */
export interface CommittedAssetMove {
  readonly move: AssetMove;
  readonly libraryBefore: AssetLibraryView;
}

/**
 * Moves an asset, and lets the screen say so before the server has answered.
 *
 * A drag that waited for a round trip would show the asset springing back to
 * where it came from and then jumping forward again, which reads as the drop
 * having failed.
 */
export function useMoveAsset(
  slug: string,
  filters: AssetFilters = NO_FILTERS,
): ReturnType<typeof useMutation<unknown, Error, CommittedAssetMove>> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();
  const key = libraryKey(baseUrl, slug, filters);

  return useMutation({
    mutationFn: ({ move }: CommittedAssetMove) => client.command(moveAssetCommand, move),

    // Otherwise a refetch already in flight lands on top of the drag and puts
    // the asset back where it started.
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: key });
    },

    onError: (_error, committed) => {
      queryClient.setQueryData<AssetLibraryView>(key, committed.libraryBefore);
    },

    // Asked for again either way: the positions the server worked out are the
    // ones that survive, and a category's count came from it too.
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      await queryClient.invalidateQueries({ queryKey: workspaceKey(baseUrl, slug) });
    },
  });
}

/**
 * What a finished heading drag sends, and what to put back if it is refused.
 *
 * The same shape a tile's move takes, and for the same reason: by the time this
 * is sent the screen already shows the heading in its new place.
 */
export interface CommittedCategoryMove {
  readonly move: CategoryMove;
  /**
   * The library to put back if the server refuses, and null when there is
   * nothing to put back.
   *
   * A drag has already redrawn the screen by the time it sends, so it always has
   * one. The dialog that moves a category into another has drawn nothing yet —
   * it waits for the answer like any other form, so a refusal leaves the screen
   * exactly as it is and the refetch tells the truth either way.
   */
  readonly libraryBefore: AssetLibraryView | null;
}

/**
 * Moves a category up or down the library, before the server has answered.
 *
 * `useMoveAsset`'s twin, down to the cancelled refetch: a list refetched
 * mid-drag lands on top of the headings and puts the one being carried back
 * where it started.
 */
export function useMoveAssetCategory(
  slug: string,
  filters: AssetFilters = NO_FILTERS,
): ReturnType<typeof useMutation<unknown, Error, CommittedCategoryMove>> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();
  const key = libraryKey(baseUrl, slug, filters);

  return useMutation({
    mutationFn: ({ move }: CommittedCategoryMove) => client.command(moveAssetCategoryCommand, move),

    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: key });
    },

    onError: (_error, committed) => {
      if (committed.libraryBefore !== null) {
        queryClient.setQueryData<AssetLibraryView>(key, committed.libraryBefore);
      }
    },

    // Asked for again either way: the positions the server worked out are the
    // ones that survive.
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      await queryClient.invalidateQueries({ queryKey: workspaceKey(baseUrl, slug) });
    },
  });
}

/** Reads and writes the library the screen is showing, for a drag in flight. */
export function useAssetLibraryPreview(
  slug: string,
  filters: AssetFilters = NO_FILTERS,
): {
  read: () => AssetLibraryView | undefined;
  write: (view: AssetLibraryView) => void;
} {
  const { baseUrl } = useApiClient();
  const queryClient = useQueryClient();
  const key = libraryKey(baseUrl, slug, filters);

  return {
    read: () => queryClient.getQueryData<AssetLibraryView>(key),
    write: (view: AssetLibraryView) => {
      queryClient.setQueryData<AssetLibraryView>(key, view);
    },
  };
}

const assetKey = (baseUrl: string, assetId: string) => ['asset', baseUrl, assetId] as const;

export function useAsset(assetId: string): UseQueryResult<AssetDetailView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: assetKey(baseUrl, assetId),
    queryFn: () => client.query(assetDetailQuery, { assetId }),
  });
}

export type UpdateAssetInput = z.input<typeof updateAssetCommand.inputSchema>;

/**
 * Changes an asset, and refetches both the asset and the library.
 *
 * Both, because a change of name or estimate shows on the tile as well as in the
 * panel — and the tile is what somebody is looking at when they close it.
 */
export function useUpdateAsset(
  slug: string,
  assetId: string,
): ReturnType<typeof useMutation<unknown, Error, UpdateAssetInput>> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();
  const refresh = useLibraryRefresh(slug);

  return useMutation({
    mutationFn: (input: UpdateAssetInput) => client.command(updateAssetCommand, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetKey(baseUrl, assetId) });
      await refresh();
    },
  });
}

export type CreateAssetCategoryInput = z.input<typeof createAssetCategoryCommand.inputSchema>;
export type CreateAssetInput = z.input<typeof createAssetCommand.inputSchema>;

export function useCreateAssetCategory(
  slug: string,
): ReturnType<typeof useMutation<unknown, Error, CreateAssetCategoryInput>> {
  const { client } = useApiClient();
  const refresh = useLibraryRefresh(slug);

  return useMutation({
    mutationFn: (input: CreateAssetCategoryInput) =>
      client.command(createAssetCategoryCommand, input),
    onSuccess: refresh,
  });
}

export type UpdateAssetCategoryInput = z.input<typeof updateAssetCategoryCommand.inputSchema>;

/** Changes what a category is called, what colour it is, what it should cost. */
export function useUpdateAssetCategory(
  slug: string,
): ReturnType<typeof useMutation<unknown, Error, UpdateAssetCategoryInput>> {
  const { client } = useApiClient();
  const refresh = useLibraryRefresh(slug);

  return useMutation({
    mutationFn: (input: UpdateAssetCategoryInput) =>
      client.command(updateAssetCategoryCommand, input),
    onSuccess: refresh,
  });
}

/**
 * Takes a category out of the library.
 *
 * Only the library is refetched, and it has to be: what the category held has
 * moved to another heading on the same screen, so half of it would otherwise
 * still be drawn under a heading that no longer exists.
 */
export function useDeleteAssetCategory(
  slug: string,
): ReturnType<typeof useMutation<unknown, Error, { categoryId: string }>> {
  const { client } = useApiClient();
  const refresh = useLibraryRefresh(slug);

  return useMutation({
    mutationFn: (input: { categoryId: string }) =>
      client.command(deleteAssetCategoryCommand, input),
    onSuccess: refresh,
  });
}

/**
 * Takes an asset out of the library.
 *
 * The library is refetched because the tile has gone, and so is any card that
 * was about the asset: its panel would otherwise go on listing a link to
 * something that no longer exists.
 */
export function useDeleteAsset(
  slug: string,
): ReturnType<typeof useMutation<unknown, Error, { assetId: string }>> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();
  const refresh = useLibraryRefresh(slug);

  return useMutation({
    mutationFn: (input: { assetId: string }) => client.command(deleteAssetCommand, input),
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['card', baseUrl] });
    },
  });
}

export function useCreateAsset(
  slug: string,
): ReturnType<typeof useMutation<unknown, Error, CreateAssetInput>> {
  const { client } = useApiClient();
  const refresh = useLibraryRefresh(slug);

  return useMutation({
    mutationFn: (input: CreateAssetInput) => client.command(createAssetCommand, input),
    onSuccess: refresh,
  });
}

/**
 * Refetches the library after a write.
 *
 * A command returns an identifier and nothing else, so the screen finds out what
 * changed by asking again — the one read path, rather than a second copy of the
 * view assembled on the client.
 */
function useLibraryRefresh(slug: string): () => Promise<void> {
  const { baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['assets', baseUrl, slug] });
    await queryClient.invalidateQueries({ queryKey: workspaceKey(baseUrl, slug) });
  };
}

export type LinkAssetInput = z.input<typeof linkAssetCommand.inputSchema>;

/**
 * Says a card is about an asset, or takes that back.
 *
 * Both sides are refetched: the card shows the asset and the asset shows the
 * card, and somebody who links from one is usually about to look at the other.
 */
export function useLinkAsset(
  projectSlug: string,
  cardId: string,
): ReturnType<typeof useMutation<unknown, Error, LinkAssetInput>> {
  const { client } = useApiClient();
  const refresh = useLinkRefresh(projectSlug, cardId);

  return useMutation({
    mutationFn: (input: LinkAssetInput) => client.command(linkAssetCommand, input),
    onSuccess: refresh,
  });
}

export function useUnlinkAsset(
  projectSlug: string,
  cardId: string,
): ReturnType<typeof useMutation<unknown, Error, { linkId: string }>> {
  const { client } = useApiClient();
  const refresh = useLinkRefresh(projectSlug, cardId);

  return useMutation({
    mutationFn: (input: { linkId: string }) => client.command(unlinkAssetCommand, input),
    onSuccess: refresh,
  });
}

function useLinkRefresh(projectSlug: string, cardId: string): () => Promise<void> {
  const { baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['card', baseUrl, cardId] });
    await queryClient.invalidateQueries({ queryKey: ['asset', baseUrl] });
    await queryClient.invalidateQueries({ queryKey: ['assets', baseUrl, projectSlug] });
  };
}

/**
 * Adds pictures to an asset's reference sheet.
 *
 * Several at once, because that is how reference arrives: somebody finishes a
 * pass and has four images, not one. They are uploaded one after another rather
 * than together — the sheet keeps the order they were chosen in, and six
 * concurrent uploads would land in whatever order the network decided.
 *
 * Both the panel and the library are refetched: the tile behind the panel shows
 * the first picture and a count, and both have just changed.
 */
export function useAddAssetReferences(
  projectSlug: string,
  assetId: string,
): ReturnType<typeof useMutation<string[], Error, readonly File[]>> {
  const { client } = useApiClient();
  const refresh = useAssetRefresh(projectSlug, assetId);

  return useMutation({
    mutationFn: async (files: readonly File[]) => {
      const ids: string[] = [];

      for (const file of files) {
        ids.push(await uploadFile(client, { kind: 'assetReference', assetId }, file));
      }

      return ids;
    },
    onSuccess: refresh,
  });
}

/**
 * Takes a picture off the sheet, or moves one to the front of it.
 *
 * Two commands rather than one with a flag: removing a reference throws work
 * away and promoting one does not, and a single control that did both depending
 * on an argument is how the wrong one gets called.
 */
export function useRemoveAssetReference(
  projectSlug: string,
  assetId: string,
): ReturnType<typeof useMutation<unknown, Error, { referenceId: string }>> {
  const { client } = useApiClient();
  const refresh = useAssetRefresh(projectSlug, assetId);

  return useMutation({
    mutationFn: (input: { referenceId: string }) =>
      client.command(removeAssetReferenceCommand, input),
    onSuccess: refresh,
  });
}

export interface MoveReferenceInput {
  referenceId: string;
  beforeReferenceId?: string | null;
  afterReferenceId?: string | null;
}

/**
 * Drops a reference somewhere else on the sheet.
 *
 * The general form of promoting one: the front of the sheet is the thumbnail,
 * so dragging a picture there and pressing "make thumbnail" are the same act.
 */
export function useMoveAssetReference(
  projectSlug: string,
  assetId: string,
): ReturnType<typeof useMutation<unknown, Error, MoveReferenceInput>> {
  const { client } = useApiClient();
  const refresh = useAssetRefresh(projectSlug, assetId);

  return useMutation({
    mutationFn: (input: MoveReferenceInput) => client.command(moveAssetReferenceCommand, input),
    onSuccess: refresh,
  });
}

export function usePromoteAssetReference(
  projectSlug: string,
  assetId: string,
): ReturnType<typeof useMutation<unknown, Error, { referenceId: string }>> {
  const { client } = useApiClient();
  const refresh = useAssetRefresh(projectSlug, assetId);

  return useMutation({
    mutationFn: (input: { referenceId: string }) =>
      client.command(promoteAssetReferenceCommand, input),
    onSuccess: refresh,
  });
}

/**
 * Puts a working file on an asset: the source, not a picture of it.
 *
 * Several at once, as the reference sheet takes them — a hand-off is usually a
 * folder, not a file. Only the panel is refetched: a tile says how many
 * pictures an asset has and how much work hangs off it, and neither of those
 * is this.
 */
export function useAddAssetFiles(
  projectSlug: string,
  assetId: string,
): ReturnType<typeof useMutation<string[], Error, readonly File[]>> {
  const { client } = useApiClient();
  const refresh = useAssetRefresh(projectSlug, assetId);

  return useMutation({
    mutationFn: async (files: readonly File[]) => {
      const ids: string[] = [];

      for (const file of files) {
        ids.push(await uploadFile(client, { kind: 'assetFile', assetId }, file));
      }

      return ids;
    },
    onSuccess: refresh,
  });
}

export type LinkAssetFileInput = z.input<typeof linkAssetFileCommand.inputSchema>;

/**
 * Points the asset at a file that lives somewhere else.
 *
 * The other half of uploading one. A studio with a depot or a NAS already keeps
 * the source somewhere, and a library that could only hold copies would be a
 * library holding out-of-date copies.
 */
export function useLinkAssetFile(
  projectSlug: string,
  assetId: string,
): ReturnType<typeof useMutation<unknown, Error, LinkAssetFileInput>> {
  const { client } = useApiClient();
  const refresh = useAssetRefresh(projectSlug, assetId);

  return useMutation({
    mutationFn: (input: LinkAssetFileInput) => client.command(linkAssetFileCommand, input),
    onSuccess: refresh,
  });
}

export function useRemoveAssetFile(
  projectSlug: string,
  assetId: string,
): ReturnType<typeof useMutation<unknown, Error, { assetFileId: string }>> {
  const { client } = useApiClient();
  const refresh = useAssetRefresh(projectSlug, assetId);

  return useMutation({
    mutationFn: (input: { assetFileId: string }) => client.command(removeAssetFileCommand, input),
    onSuccess: refresh,
  });
}

export type TagAssetInput = z.input<typeof tagAssetCommand.inputSchema>;

/**
 * Files an asset under a word, or takes the word off again.
 *
 * Both refetch the library as well as the panel: tags are on the tile, and
 * finding an asset by one is the whole reason for putting it there.
 */
export function useTagAsset(
  projectSlug: string,
  assetId: string,
): ReturnType<typeof useMutation<unknown, Error, TagAssetInput>> {
  const { client } = useApiClient();
  const refresh = useAssetRefresh(projectSlug, assetId);

  return useMutation({
    mutationFn: (input: TagAssetInput) => client.command(tagAssetCommand, input),
    onSuccess: refresh,
  });
}

export function useUntagAsset(
  projectSlug: string,
  assetId: string,
): ReturnType<typeof useMutation<unknown, Error, TagAssetInput>> {
  const { client } = useApiClient();
  const refresh = useAssetRefresh(projectSlug, assetId);

  return useMutation({
    mutationFn: (input: TagAssetInput) => client.command(untagAssetCommand, input),
    onSuccess: refresh,
  });
}

export type AddAssetSubtaskInput = z.input<typeof addAssetSubtaskCommand.inputSchema>;
export type UpdateAssetSubtaskInput = z.input<typeof updateAssetSubtaskCommand.inputSchema>;
export type RemoveAssetSubtaskInput = z.input<typeof removeAssetSubtaskCommand.inputSchema>;

/**
 * The stages an asset is made in.
 *
 * All three refresh the panel and the tile, because the tile carries the count:
 * ticking Mesh off in the panel has to move `2/5` to `3/5` behind it, or the
 * library disagrees with the thing open on top of it.
 */
export function useAddAssetSubtask(
  projectSlug: string,
  assetId: string,
): ReturnType<typeof useMutation<unknown, Error, AddAssetSubtaskInput>> {
  const { client } = useApiClient();
  const refresh = useAssetRefresh(projectSlug, assetId);

  return useMutation({
    mutationFn: (input: AddAssetSubtaskInput) => client.command(addAssetSubtaskCommand, input),
    onSuccess: refresh,
  });
}

export function useUpdateAssetSubtask(
  projectSlug: string,
  assetId: string,
): ReturnType<typeof useMutation<unknown, Error, UpdateAssetSubtaskInput>> {
  const { client } = useApiClient();
  const refresh = useAssetRefresh(projectSlug, assetId);

  return useMutation({
    mutationFn: (input: UpdateAssetSubtaskInput) =>
      client.command(updateAssetSubtaskCommand, input),
    onSuccess: refresh,
  });
}

export function useRemoveAssetSubtask(
  projectSlug: string,
  assetId: string,
): ReturnType<typeof useMutation<unknown, Error, RemoveAssetSubtaskInput>> {
  const { client } = useApiClient();
  const refresh = useAssetRefresh(projectSlug, assetId);

  return useMutation({
    mutationFn: (input: RemoveAssetSubtaskInput) =>
      client.command(removeAssetSubtaskCommand, input),
    onSuccess: refresh,
  });
}

/** The panel and the tile behind it, both of which draw the sheet. */
function useAssetRefresh(projectSlug: string, assetId: string): () => Promise<void> {
  const { baseUrl } = useApiClient();
  const queryClient = useQueryClient();
  const refresh = useLibraryRefresh(projectSlug);

  return async () => {
    await queryClient.invalidateQueries({ queryKey: assetKey(baseUrl, assetId) });
    await refresh();
  };
}
