import {
  agentsQuery,
  createAgentCommand,
  issueAgentTokenCommand,
  revokeAgentTokenCommand,
  updateAgentCommand,
  type AgentsView,
} from '@lpm/shared';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { useApiClient } from '../../components/ApiClientProvider.js';
import { uploadFile } from '../files/upload-file.js';

/** Every agent on the install, and the keys each of them has. Never a secret. */
export function useAgents(): UseQueryResult<AgentsView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: ['agents', baseUrl],
    queryFn: () => client.query(agentsQuery, {}),
  });
}

export interface NewAgent {
  readonly displayName: string;
}

export function useCreateAgent(): UseMutationResult<unknown, Error, NewAgent> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (agent: NewAgent) => client.command(createAgentCommand, agent),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agents', baseUrl] });
    },
  });
}

/**
 * Issues a key, and hands back the secret.
 *
 * The reply is the only place it ever exists in readable form, so the caller
 * has to hold on to it — nothing can fetch it again.
 */
export function useIssueAgentToken(): UseMutationResult<
  string | undefined,
  Error,
  { userId: string; name: string }
> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { userId: string; name: string }) => {
      const result = await client.command(issueAgentTokenCommand, input);

      // The one moment the key is readable. Nothing stores it, so nothing can
      // fetch it back — whoever asked for it has to copy it now.
      return result.secret;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agents', baseUrl] });
    },
  });
}

export function useRevokeAgentToken(): UseMutationResult<unknown, Error, string> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tokenId: string) => client.command(revokeAgentTokenCommand, { tokenId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agents', baseUrl] });
    },
  });
}

/**
 * Chooses an agent's picture.
 *
 * The same three steps every other upload takes, pointed at the agent rather
 * than at whoever is asking — which is the one place the product lets somebody
 * set a picture that is not their own, and only because an agent has no screen
 * to set it on.
 *
 * The thumbnail is the worker's job and arrives a moment later. What comes back
 * straight away is the original; both are the same picture.
 */
export function useSetAgentPicture(userId: string): UseMutationResult<string, Error, File> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) => uploadFile(client, { kind: 'agentAvatar', userId }, file),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agents', baseUrl] });
    },
  });
}

export interface AgentEdit {
  readonly userId: string;
  readonly displayName?: string;
  readonly initials?: string;
}

/**
 * Changes an agent's name or its letters.
 *
 * Both are things a person does for themselves on the account window. An agent
 * has no window, so somebody does it here.
 */
export function useUpdateAgent(): UseMutationResult<unknown, Error, AgentEdit> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (edit: AgentEdit) => client.command(updateAgentCommand, edit),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agents', baseUrl] });
    },
  });
}
