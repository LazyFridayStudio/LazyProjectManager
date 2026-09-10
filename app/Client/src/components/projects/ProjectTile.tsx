import { describeProjectPhase, type ProjectSummary } from '@lpm/shared';
import { Link } from '@tanstack/react-router';

import { joinClassNames } from '../../lib/join-class-names.js';
import styles from './ProjectTile.module.css';

/**
 * One project on the launcher.
 *
 * The whole tile is the link. A card-sized hit area that only responds on its
 * title is the most common way a grid of these ends up feeling broken.
 */
export function ProjectTile({ project }: { project: ProjectSummary }): React.JSX.Element {
  const isArchived = project.archivedAt !== null;

  return (
    <Link
      to="/p/$slug"
      params={{ slug: project.slug }}
      // Named here rather than by its text: a tile with key art on it is a
      // picture and a line of meta, and a link announced as `Production · Godot
      // · Lead` is a link nobody using a screen reader can pick out of a slate
      // of them.
      aria-label={project.name}
      className={joinClassNames(styles.tile, isArchived && styles.archived)}
    >
      <ProjectThumb project={project} />

      <span className={styles.meta}>
        <span>{describeProjectPhase(project.phase)}</span>
        {project.engine !== null && (
          <>
            <span aria-hidden>·</span>
            <span>{project.engine}</span>
          </>
        )}
        <span className={styles.role}>{isArchived ? 'Archived' : project.role}</span>
      </span>
    </Link>
  );
}

/**
 * The picture, or the name in the middle of where it would go.
 *
 * The name rather than nothing, because a blank panel reads as a picture that
 * failed to load rather than one nobody has chosen yet — and it is the thing
 * somebody is looking for anyway. A project with key art says its name in the
 * art, which is why that is all a tile needs.
 */
function ProjectThumb({ project }: { project: ProjectSummary }): React.JSX.Element {
  if (project.keyArtUrl !== null) {
    return <img className={styles.thumbImage} src={project.keyArtUrl} alt="" />;
  }

  return <span className={styles.thumb}>{project.name}</span>;
}
