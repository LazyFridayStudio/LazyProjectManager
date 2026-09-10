import {
  connectScmAppCommand,
  disconnectScmAppCommand,
  connectScmCommand,
  disconnectScmCommand,
  scmConnectionQuery,
  type ScmConnection,
} from '@lpm/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { z } from 'zod';

import { useApiClient } from '../../components/ApiClientProvider.js';

/** Namespaced by base URL, as everywhere: switching servers must not show the last one's repository. */
const queryKey = (baseUrl: string, projectId: string) => ['scm', baseUrl, projectId] as const;

export function useScmConnection(
  projectId: string,
): UseQueryResult<{ connection: ScmConnection | null }> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: queryKey(baseUrl, projectId),
    queryFn: () => client.query(scmConnectionQuery, { projectId }),
  });
}

export type ConnectScmInput = z.input<typeof connectScmCommand.inputSchema>;

export function useConnectScm(
  projectId: string,
): ReturnType<typeof useMutation<unknown, Error, ConnectScmInput>> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ConnectScmInput) => client.command(connectScmCommand, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKey(baseUrl, projectId) }),
  });
}

export function useDisconnectScm(
  projectId: string,
): ReturnType<typeof useMutation<unknown, Error, void>> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.command(disconnectScmCommand, { projectId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKey(baseUrl, projectId) }),
  });
}

/**
 * A secret nobody has to remember, made where it is shown.
 *
 * Generated in the browser rather than on the server so it crosses the wire once
 * — on the way in — instead of coming back in a response that a proxy, a log or
 * a network panel would keep a copy of.
 */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);

  return `wh_${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export type ConnectScmAppInput = z.input<typeof connectScmAppCommand.inputSchema>;

/**
 * Gives the connection credentials to read the repository.
 *
 * The server checks them against the forge before storing, so a failure here is
 * a wrong key or an installation on the wrong repository — something to fix on
 * the form rather than something to discover a fortnight later.
 */
export function useConnectScmApp(
  projectId: string,
): ReturnType<typeof useMutation<unknown, Error, ConnectScmAppInput>> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ConnectScmAppInput) => client.command(connectScmAppCommand, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKey(baseUrl, projectId) }),
  });
}

export function useDisconnectScmApp(
  projectId: string,
): ReturnType<typeof useMutation<unknown, Error, void>> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.command(disconnectScmAppCommand, { projectId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKey(baseUrl, projectId) }),
  });
}
