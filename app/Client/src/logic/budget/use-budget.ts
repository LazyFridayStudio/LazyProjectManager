import { projectBudgetQuery, type ProjectBudgetView } from '@lpm/shared';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../components/ApiClientProvider.js';

/**
 * What the project is going to cost, counted rather than kept.
 *
 * Under the `projects` key so realtime invalidation reaches it: approving an
 * asset in the library commits its estimate, and the screen beside it has to
 * say so without being reloaded.
 */
export function useBudget(slug: string): UseQueryResult<ProjectBudgetView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: ['projects', baseUrl, 'budget', slug],
    queryFn: () => client.query(projectBudgetQuery, { slug }),
  });
}
