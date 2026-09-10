import {
  completeSetupCommand,
  healthQuery,
  meQuery,
  signInCommand,
  signOutCommand,
  type HealthView,
  type MeView,
} from '@lpm/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { ApiFailureError, type ApiClient } from '../../api/index.js';
import { useApiClient } from '../../components/ApiClientProvider.js';

/**
 * Query keys are namespaced by base URL. Switching servers must not show the
 * previous server's cached user for even one frame.
 */
const queryKeys = {
  health: (baseUrl: string) => ['health', baseUrl] as const,
  me: (baseUrl: string) => ['me', baseUrl] as const,
};

export function useServerHealth(): UseQueryResult<HealthView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: queryKeys.health(baseUrl),
    queryFn: () => client.query(healthQuery, {}),
    retry: false,
    // The connect screen is where someone fixes a typo in a URL. Waiting on a
    // stale success would tell them the wrong server is fine.
    staleTime: 0,
  });
}

/**
 * The signed-in user, or null.
 *
 * An `UNAUTHENTICATED` failure is the normal answer before signing in, so it
 * resolves to null rather than throwing — only a genuine fault becomes an error.
 */
export function useSignedInUser(): UseQueryResult<MeView | null> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: queryKeys.me(baseUrl),
    queryFn: () => loadSignedInUser(client),
    retry: false,
  });
}

async function loadSignedInUser(client: ApiClient): Promise<MeView | null> {
  try {
    return await client.query(meQuery, {});
  } catch (error) {
    if (error instanceof ApiFailureError && error.code === 'UNAUTHENTICATED') {
      return null;
    }

    throw error;
  }
}

/**
 * The signed-in user, insisted upon.
 *
 * Every screen inside the router is rendered under the gate in `AppRoot`, so
 * the query has already resolved and this reads from cache. The throw states
 * that invariant rather than making every screen handle a null it cannot get.
 */
export function useRequiredIdentity(): MeView {
  const signedInUser = useSignedInUser();

  if (signedInUser.data === null || signedInUser.data === undefined) {
    throw new Error('A screen inside the signed-in app rendered without an identity.');
  }

  return signedInUser.data;
}

/**
 * Whether the signed-in person may do something on this install.
 *
 * The server decided it, on the session query, from their role and every
 * permission group they hold. Asking here rather than working it out from the
 * role is the whole point of the groups: `recovery.restore` can be handed to
 * somebody who is not an owner, and a shell that checked `role === 'owner'`
 * would hide the tab from them anyway.
 *
 * This hides what would be refused; it does not grant anything. Every handler
 * asks the same question again for itself.
 */
export function useMay(): (action: string) => boolean {
  const identity = useRequiredIdentity();

  return (action) => identity.may.includes(action);
}

export function useSignIn(): ReturnType<
  typeof useMutation<unknown, Error, { email: string; password: string }>
> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      client.command(signInCommand, credentials),
    onSuccess: async () => {
      // The command returns identifiers only, so the user comes from refetching
      // the query rather than from the response body.
      await queryClient.invalidateQueries({ queryKey: queryKeys.me(baseUrl) });
    },
  });
}

export interface CompleteSetupInput {
  serverName: string;
  baseUrl: string;
  admin: { email: string; password: string; displayName: string };
}

export function useCompleteSetup(): ReturnType<
  typeof useMutation<unknown, Error, CompleteSetupInput>
> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CompleteSetupInput) => client.command(completeSetupCommand, input),
    onSuccess: async () => {
      // Setup signs the new owner in, so both the health view and the user are
      // stale: `setupCompleted` has flipped and there is now a session.
      await queryClient.invalidateQueries({ queryKey: queryKeys.me(baseUrl) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.health(baseUrl) });
    },
  });
}

export function useSignOut(): ReturnType<typeof useMutation<unknown, Error, void>> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.command(signOutCommand, {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.me(baseUrl) });
    },
  });
}
