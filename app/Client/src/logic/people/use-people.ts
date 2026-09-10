import {
  changePasswordCommand,
  createUserCommand,
  peopleQuery,
  resetUserPasswordCommand,
  setUserPermissionGroupCommand,
  setUserRoleCommand,
  setUserStatusCommand,
  type PeopleView,
} from '@lpm/shared';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import type { z } from 'zod';

import { useApiClient } from '../../components/ApiClientProvider.js';

export type CreateUserInput = z.input<typeof createUserCommand.inputSchema>;
export type SetUserGroupInput = z.input<typeof setUserPermissionGroupCommand.inputSchema>;
export type SetUserRoleInput = z.input<typeof setUserRoleCommand.inputSchema>;
export type SetUserStatusInput = z.input<typeof setUserStatusCommand.inputSchema>;
export type ResetUserPasswordInput = z.input<typeof resetUserPasswordCommand.inputSchema>;
export type ChangePasswordInput = z.input<typeof changePasswordCommand.inputSchema>;

/** Which people to list: everybody, a team's members, or everybody else. */
export interface PeopleRequest {
  readonly search: string;
  /** Only the people in this team. */
  readonly inTeamId?: string;
  /** Only the people who are not, which is what a picker offers. */
  readonly notInTeamId?: string;
}

/**
 * People, a page at a time, narrowed by what was typed.
 *
 * The whole request is the query key, so a search and a team's members are two
 * lists rather than pages of two different questions stacked on each other.
 */
export function usePeople(request: PeopleRequest): UseInfiniteQueryResult<{ pages: PeopleView[] }> {
  const { client, baseUrl } = useApiClient();
  const { search, inTeamId, notInTeamId } = request;

  return useInfiniteQuery({
    queryKey: ['people', baseUrl, search, inTeamId ?? '', notInTeamId ?? ''],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      client.query(peopleQuery, {
        ...(search === '' ? {} : { search }),
        ...(inTeamId === undefined ? {} : { inTeamId }),
        ...(notInTeamId === undefined ? {} : { notInTeamId }),
        ...(pageParam === undefined ? {} : { after: pageParam }),
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useCreateUser(): ReturnType<typeof useMutation<unknown, Error, CreateUserInput>> {
  const { client } = useApiClient();
  const refresh = usePeopleRefresh();

  return useMutation({
    mutationFn: (input: CreateUserInput) => client.command(createUserCommand, input),
    onSuccess: refresh,
  });
}

export function useSetUserRole(): ReturnType<typeof useMutation<unknown, Error, SetUserRoleInput>> {
  const { client } = useApiClient();
  const refresh = usePeopleRefresh();

  return useMutation({
    mutationFn: (input: SetUserRoleInput) => client.command(setUserRoleCommand, input),
    onSuccess: refresh,
  });
}

export function useSetUserStatus(): ReturnType<
  typeof useMutation<unknown, Error, SetUserStatusInput>
> {
  const { client } = useApiClient();
  const refresh = usePeopleRefresh();

  return useMutation({
    mutationFn: (input: SetUserStatusInput) => client.command(setUserStatusCommand, input),
    onSuccess: refresh,
  });
}

export function useResetUserPassword(): ReturnType<
  typeof useMutation<unknown, Error, ResetUserPasswordInput>
> {
  const { client } = useApiClient();
  const refresh = usePeopleRefresh();

  return useMutation({
    mutationFn: (input: ResetUserPasswordInput) => client.command(resetUserPasswordCommand, input),
    onSuccess: refresh,
  });
}

/**
 * Changes your own password.
 *
 * Nothing to refresh: the list does not show passwords, and the server reissues
 * the session cookie so this browser stays signed in while every other one is
 * signed out.
 */
export function useChangePassword(): ReturnType<
  typeof useMutation<unknown, Error, ChangePasswordInput>
> {
  const { client } = useApiClient();

  return useMutation({
    mutationFn: (input: ChangePasswordInput) => client.command(changePasswordCommand, input),
  });
}

/**
 * Gives one person a permission group, or takes it back.
 *
 * Both lists are asked again afterwards. The people list is what the screen is
 * drawing, and the permissions screen counts who holds each group — so a change
 * here is a change there, and neither is worth guessing at.
 */
export function useSetUserGroup(): ReturnType<
  typeof useMutation<unknown, Error, SetUserGroupInput>
> {
  const { client, baseUrl } = useApiClient();
  const queryClient = useQueryClient();
  const refresh = usePeopleRefresh();

  return useMutation({
    mutationFn: (input: SetUserGroupInput) => client.command(setUserPermissionGroupCommand, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['permissions', baseUrl] });
      /*
       * The agents too, because an agent is a user and this changes a user's
       * groups. The hook is named for the command rather than for the screen it
       * was first written for, and the command has never asked what kind of
       * user it was given — so anything drawing somebody's groups has to be
       * told, or it goes on showing what they held a moment ago.
       */
      await queryClient.invalidateQueries({ queryKey: ['agents', baseUrl] });
      await refresh();
    },
  });
}

/**
 * Refetches every page of every search after somebody changes.
 *
 * A role or a suspension changes one row, but which searches that row appears in
 * is not something this side can work out — and there are at most a handful of
 * cached searches to refetch.
 */
function usePeopleRefresh(): () => Promise<void> {
  const { baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['people', baseUrl] });
  };
}
