import { seeMentionCommand, waitingMentionsQuery, type WaitingMentionsView } from '@lpm/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../components/ApiClientProvider.js';

/** How often the mark asks whether anything has arrived. */
const ASK_EVERY_MS = 30_000;

/**
 * What is waiting for you, anywhere on the install.
 *
 * Asked on a timer rather than pushed. The realtime hub deals in "this project
 * went stale" and a socket watches the one project a tab has open, so a mention
 * left on another board has no route to it — and teaching the hub to address a
 * person rather than a project is a larger change than a red circle is worth.
 *
 * Half a minute, and again whenever the window is focused, which is the moment
 * somebody has come back to look. A mention is not a chat message: a minute late
 * is not late.
 */
export function useWaitingMentions(): UseQueryResult<WaitingMentionsView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: ['mentions', baseUrl],
    queryFn: () => client.query(waitingMentionsQuery, {}),
    refetchInterval: ASK_EVERY_MS,
    // Nothing here is worth an error on screen. A mark that briefly does not
    // know is a mark that shows nothing, which is what it shows most of the time
    // anyway.
    retry: false,
  });
}

/**
 * Takes one off the mark.
 *
 * Fired as the card it names is opened, so the count goes down as the thing you
 * were told about comes into view.
 */
export function useSeeMention(): ReturnType<typeof useMutation<unknown, Error, string>> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (mentionId: string) => client.command(seeMentionCommand, { mentionId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mentions', baseUrl] });
    },
  });
}
