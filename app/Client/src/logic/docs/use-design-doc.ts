import {
  createDesignDocCommand,
  deleteDesignDocCommand,
  designDocQuery,
  moveDesignDocCommand,
  renameDesignDocCommand,
  updateDesignDocCommand,
  type CommandSuccess,
  type DesignDocView,
} from '@lpm/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { z } from 'zod';

import { useApiClient } from '../../components/ApiClientProvider.js';

/**
 * A project's documents, and the one being read.
 *
 * Under the `projects` key so realtime invalidation reaches it: the contents
 * list down the side is read from the same answer the page is, and both should
 * move when somebody else writes.
 */
export function useDesignDoc(
  slug: string,
  docId: string | undefined,
): UseQueryResult<DesignDocView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: ['projects', baseUrl, 'doc', slug, docId ?? 'first'],
    queryFn: () => client.query(designDocQuery, docId === undefined ? { slug } : { slug, docId }),
  });
}

type CreateInput = z.input<typeof createDesignDocCommand.inputSchema>;
type RenameInput = z.input<typeof renameDesignDocCommand.inputSchema>;
type UpdateInput = z.input<typeof updateDesignDocCommand.inputSchema>;
type DeleteInput = z.input<typeof deleteDesignDocCommand.inputSchema>;
type MoveInput = z.input<typeof moveDesignDocCommand.inputSchema>;

type DocMutation<TInput> = ReturnType<typeof useMutation<CommandSuccess, Error, TInput>>;

/**
 * Adds a document, and answers with its id.
 *
 * The id matters here and nowhere else in this file: an import has somewhere to
 * go afterwards, and a document that arrives without opening is one the person
 * who imported it has to go looking for in the row of tabs.
 */
export function useCreateDesignDoc(): DocMutation<CreateInput> {
  return useDocMutation((client, input: CreateInput) =>
    client.command(createDesignDocCommand, input),
  );
}

export function useRenameDesignDoc(): DocMutation<RenameInput> {
  return useDocMutation((client, input: RenameInput) =>
    client.command(renameDesignDocCommand, input),
  );
}

/** Writes a document. Last write wins, as the command says. */
export function useUpdateDesignDoc(): DocMutation<UpdateInput> {
  return useDocMutation((client, input: UpdateInput) =>
    client.command(updateDesignDocCommand, input),
  );
}

/**
 * Moves a document along the row of tabs.
 *
 * Said as its two new neighbours rather than as a position: the row is the
 * project's and a screen sending a number would be sending an opinion about
 * every other document as well.
 */
export function useMoveDesignDoc(): DocMutation<MoveInput> {
  return useDocMutation((client, input: MoveInput) => client.command(moveDesignDocCommand, input));
}

export function useDeleteDesignDoc(): DocMutation<DeleteInput> {
  return useDocMutation((client, input: DeleteInput) =>
    client.command(deleteDesignDocCommand, input),
  );
}

type ApiClient = ReturnType<typeof useApiClient>['client'];

/**
 * Every document command refetches the documents.
 *
 * Commands answer with an identifier and nothing else, so what changed comes
 * from asking again — and a document is small enough that asking again is
 * cheaper than keeping a copy of it in step by hand.
 */
function useDocMutation<TInput>(
  send: (client: ApiClient, input: TInput) => Promise<CommandSuccess>,
): DocMutation<TInput> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: TInput) => send(client, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects', baseUrl] });
    },
  });
}
