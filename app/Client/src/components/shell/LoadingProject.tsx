import { Loading } from '../ui/index.js';
import { ProjectShell, type ProjectSection } from './ProjectShell.js';
import { useProject } from '../../logic/projects/index.js';

/**
 * A project screen that has not arrived, with its sidebar already there.
 *
 * Every screen inside a project used to return a bare `Loading…` paragraph
 * before its query answered, which meant the sidebar and the header came down
 * with it: switching from the board to the budget blanked the entire window and
 * drew it again. The word was never the problem. The whole page going white for
 * a tenth of a second was.
 *
 * The chrome comes from `projects.detail`, which is one query for one project
 * shared by every screen in it — so it is fetched once when you first open a
 * project and read from the cache on every move between its pages, which is
 * exactly when this matters.
 *
 * Before that first answer there is genuinely nothing to draw a sidebar from,
 * so the spinner takes the window. Guessing at a name from the slug would put
 * the wrong words in the sidebar for a moment, which is worse than an empty
 * frame.
 */
export function LoadingProject({
  slug,
  active,
}: {
  slug: string;
  active: ProjectSection;
}): React.JSX.Element {
  const project = useProject(slug);

  if (project.data === undefined) {
    return <Loading />;
  }

  return (
    <ProjectShell project={project.data.project} active={active}>
      <Loading />
    </ProjectShell>
  );
}
