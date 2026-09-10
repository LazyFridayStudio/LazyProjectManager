import { PROJECT_PEOPLE_LISTED, projectPeopleQuery, type ProjectPeopleView } from '@lpm/shared';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../components/ApiClientProvider.js';

/**
 * The crew of this project, for a control that offers all of them.
 *
 * The narrower of the two lists `projects.people` answers: the people named on
 * the project or in a team that is, and not the owners and leads who can open
 * every board in the studio without being on any of them. A dropdown offering
 * every lead for a project none of them touch is noise, and the server refuses
 * a card handed to one of them anyway.
 *
 * Whoever made the project is on it by name, so this is never empty for the
 * person most likely to be looking at it.
 *
 * Held for a while, because a project's crew changes far more slowly than
 * somebody opens cards, and every card panel asks this.
 */
export function useProjectCrew(projectId: string): UseQueryResult<ProjectPeopleView> {
  const { client, baseUrl } = useApiClient();

  return useQuery({
    queryKey: ['project-crew', baseUrl, projectId],
    queryFn: () =>
      client.query(projectPeopleQuery, { projectId, limit: PROJECT_PEOPLE_LISTED, who: 'crew' }),
    staleTime: 60_000,
  });
}
