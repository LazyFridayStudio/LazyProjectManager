import { projectTimelineQuery, type ProjectTimelineView, type TimelineGrouping } from '@lpm/shared';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../components/ApiClientProvider.js';

/**
 * Who is doing what over a fortnight, and whether it fits.
 *
 * Under the `projects` key so realtime invalidation reaches it: giving a card a
 * date or an owner on the board has to move the chart on the screen beside it.
 *
 * The previous fortnight stays on screen while the next one loads, because the
 * two are the same shape and blanking a chart to redraw it a column to the left
 * loses the reader's place.
 */
export function useTimeline(
  slug: string,
  from: string | undefined,
  groupBy: TimelineGrouping,
): UseQueryResult<ProjectTimelineView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: ['projects', baseUrl, 'timeline', slug, from ?? 'today', groupBy],
    queryFn: () =>
      client.query(
        projectTimelineQuery,
        from === undefined ? { slug, groupBy } : { slug, from, groupBy },
      ),
    placeholderData: keepPreviousData,
  });
}
