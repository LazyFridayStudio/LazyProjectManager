import { projectDashboardQuery, type ProjectDashboardView } from '@lpm/shared';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../components/ApiClientProvider.js';

/**
 * The state of a project, counted rather than stored.
 *
 * Under the `projects` key so the realtime invalidation reaches it: closing a
 * card on the board has to move the burndown on the screen beside it, and
 * approving an asset has to move the budget.
 */
export function useDashboard(slug: string): UseQueryResult<ProjectDashboardView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: ['projects', baseUrl, 'dashboard', slug],
    queryFn: () => client.query(projectDashboardQuery, { slug }),
  });
}
