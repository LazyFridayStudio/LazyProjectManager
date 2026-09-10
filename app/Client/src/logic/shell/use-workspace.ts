import { projectWorkspaceQuery, type ProjectWorkspaceView } from '@lpm/shared';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../components/ApiClientProvider.js';

/**
 * What the sidebar knows about a project.
 *
 * Under the `projects` key so the realtime invalidation for a project reaches
 * it: a category added on the library screen has to change the tree in the nav
 * beside it, and a card closed on the board has to change the badge.
 */
export function useWorkspace(slug: string): UseQueryResult<ProjectWorkspaceView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: ['projects', baseUrl, 'workspace', slug],
    queryFn: () => client.query(projectWorkspaceQuery, { slug }),
  });
}
