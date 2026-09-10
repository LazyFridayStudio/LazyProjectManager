import { taskListQuery, type TaskListView } from '@lpm/shared';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../components/ApiClientProvider.js';

/**
 * Every card in one project, as a list.
 *
 * Under the `board` key, so the same invalidation frame that refreshes the board
 * refreshes this: a card moved in one view has moved in the other, and two views
 * of one project disagreeing is worse than either being a moment late.
 */
export function useTaskList(slug: string): UseQueryResult<TaskListView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: ['board', baseUrl, 'tasks', slug],
    queryFn: () => client.query(taskListQuery, { slug }),
  });
}
