import { auditTrailQuery, type AuditSubjectKind, type AuditTrailView } from '@lpm/shared';
import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../components/ApiClientProvider.js';

/** What narrows the trail. Absent means all of it. */
export interface AuditFilters {
  readonly projectId?: string;
  readonly kind?: AuditSubjectKind;
  readonly search?: string;
}

/**
 * The trail, a page at a time.
 *
 * An infinite query rather than a list with an offset: the trail grows at the
 * head while somebody reads down it, and paging by offset would show them the
 * same entry twice — or skip one, which is worse in a record of what happened.
 */
export function useAuditTrail(
  filters: AuditFilters = {},
): UseInfiniteQueryResult<{ pages: AuditTrailView[] }> {
  const { client, baseUrl } = useApiClient();
  const { projectId, kind } = filters;
  const search = filters.search?.trim() ?? '';

  return useInfiniteQuery({
    // The filters are part of the key: narrowing the trail is a different
    // question, not the same one with some rows hidden, and paging into it has
    // to start again from the newest.
    queryKey: ['audit', baseUrl, projectId ?? 'all', kind ?? 'anything', search],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      client.query(auditTrailQuery, {
        ...(pageParam === undefined ? {} : { before: pageParam }),
        ...(projectId === undefined ? {} : { projectId }),
        ...(kind === undefined ? {} : { kind }),
        ...(search === '' ? {} : { search }),
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
