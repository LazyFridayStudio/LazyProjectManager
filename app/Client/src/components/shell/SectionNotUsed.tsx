import { describeProjectSection, type ProjectSection } from '@lpm/shared';

import { LoadingProject } from './LoadingProject.js';
import { ProjectShell } from './ProjectShell.js';
import { ScreenHeader } from './ScreenHeader.js';
import { useProject } from '../../logic/projects/index.js';
import { useWorkspace } from '../../logic/shell/use-workspace.js';
import styles from './SectionNotUsed.module.css';

/**
 * A section this project has switched off, arrived at by its address.
 *
 * The routes stay registered when a section is turned off, because hiding a
 * door in the sidebar is not closing it and somebody's bookmark, or a link
 * pasted into chat months ago, still points here. What they must not find is an
 * empty chart or a not-found: the first reads as a thing nobody has filled in
 * and the second reads as data loss, and neither is what happened.
 *
 * It says the project rather than the person, because that is which of the two
 * this is. A section somebody merely lacks permission for is a different
 * sentence, said by the screen behind it when it asks for its own data — and
 * sending them to ask for a permission they already have would be the worse
 * mistake of the two.
 */
export function SectionNotUsed({
  slug,
  section,
}: {
  readonly slug: string;
  readonly section: ProjectSection;
}): React.JSX.Element {
  const project = useProject(slug);

  if (project.data === undefined) {
    return <LoadingProject slug={slug} active={section} />;
  }

  const name = describeProjectSection(section);

  return (
    <ProjectShell project={project.data.project} active={section}>
      <div className={styles.screen}>
        <ScreenHeader title={name} />

        <div className={styles.said} role="status">
          <p className={styles.headline}>
            {project.data.project.name} does not use {name}.
          </p>
          <p className={styles.note}>
            It was switched off for everybody on this project. Nothing was deleted — turning it back
            on in Settings brings the section back with everything still in it.
          </p>
        </div>
      </div>
    </ProjectShell>
  );
}

/**
 * Whether this section is one the project has switched off.
 *
 * Undefined while the sidebar is still loading, which reads as "draw it": a
 * screen that flashed this and then replaced itself with the real thing would
 * be worse than a screen that took a moment to arrive.
 */
export function useSectionIsOff(slug: string, section: ProjectSection): boolean {
  const workspace = useWorkspace(slug);

  return workspace.data?.disabledSections.includes(section) ?? false;
}
