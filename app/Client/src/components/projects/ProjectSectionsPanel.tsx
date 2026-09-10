import { useState } from 'react';

import {
  describeProjectSection,
  SWITCHABLE_PROJECT_SECTIONS,
  type ProjectDetailView,
  type SwitchableProjectSection,
} from '@lpm/shared';

import { describeFailure } from '../../api/failure-messages.js';
import { useUpdateProject } from '../../logic/projects/index.js';
import styles from './ProjectSectionsPanel.module.css';

/**
 * The sections this project does not use.
 *
 * A fact about the project rather than about the person switching it, so it
 * leaves the sidebar for everybody on it — the same as its engine or its ship
 * date. Permission is the other half and is answered elsewhere: a section
 * switched on that somebody cannot open still does not draw for them.
 *
 * Six switches, not eight. Dashboard is where the launcher sends people, and
 * Settings holds the switch that would turn it back on.
 */
export function ProjectSectionsPanel({
  detail,
}: {
  readonly detail: ProjectDetailView;
}): React.JSX.Element {
  const updateProject = useUpdateProject();
  // What was saved, until a switch is touched. The list is short and saves on
  // every press, so there is no Save button to leave somebody wondering about.
  const [disabled, setDisabled] = useState<readonly SwitchableProjectSection[]>(
    detail.disabledSections,
  );

  const set = (section: SwitchableProjectSection, isUsed: boolean): void => {
    const next = isUsed
      ? disabled.filter((candidate) => candidate !== section)
      : [...disabled, section];

    setDisabled(next);
    updateProject.mutate(
      { projectId: detail.project.id, disabledSections: [...next] },
      {
        // Put back what the server still has, rather than leaving a switch
        // showing a state nothing was saved in.
        onError: () => {
          setDisabled(detail.disabledSections);
        },
      },
    );
  };

  return (
    <div className={styles.sections}>
      <p className={styles.explanation}>
        A section switched off leaves the sidebar for everybody on this project.
        {/* Said on the screen, because "turn off Budget" reads like it might not
            be true. */}{' '}
        Nothing is deleted — the work stays where it is and comes back with the section.
      </p>

      <ul className={styles.list}>
        {SWITCHABLE_PROJECT_SECTIONS.map((section) => {
          const isUsed = !disabled.includes(section);

          return (
            <li key={section}>
              <label className={styles.row}>
                <input
                  type="checkbox"
                  checked={isUsed}
                  disabled={updateProject.isPending}
                  onChange={(event) => {
                    set(section, event.target.checked);
                  }}
                />
                <span className={styles.name}>{describeProjectSection(section)}</span>
              </label>
            </li>
          );
        })}
      </ul>

      {updateProject.error !== null && (
        <p className={styles.problem}>{describeFailure(updateProject.error)}</p>
      )}
    </div>
  );
}
