import type { CardAssignee } from '@lpm/shared';
import type { ChangeEvent } from 'react';

import { useProjectCrew } from '../../logic/projects/use-project-people.js';
import { Select } from '../ui/index.js';

export interface PersonPickerProps {
  readonly label: string;
  /** What the empty choice is called: `Nobody yet`, `Unknown`. */
  readonly nobody: string;
  readonly projectId: string;
  /** The chosen id, or an empty string for nobody. */
  readonly value: string;
  /** Who is on it already, so they can be offered even if the crew has not got them. */
  readonly was: CardAssignee | null;
  /** Off while a form is saving. Absent where a panel has no such moment. */
  readonly disabled?: boolean;
  /**
   * Why the server refused this name, shown under the control.
   *
   * The one refusal that reaches here is somebody who is not on the project,
   * which the list cannot offer and a stale list can still hold. Without it the
   * save fails, the panel stays open and nothing on screen says why.
   */
  readonly problem?: string | undefined;
  readonly onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}

/**
 * Somebody on a card or an asset, chosen from the people who reach the project.
 *
 * Only them, for the reason a mention offers nobody else: work given to
 * somebody who cannot open the project is work the one person supposed to be
 * doing it will never see. The server refuses the rest whether or not this is
 * what put the name there.
 *
 * Whoever is on it already is kept in the list even when the query does not
 * return them — somebody taken off the project since, or the crew being longer
 * than one page. Dropping them would silently reassign the thing to the first
 * name in the list the moment anybody saved anything else on it.
 *
 * Under `projects` because the list it offers is the project's. It was a
 * private function of the card panel until the asset panel needed the same
 * control, and the second copy is where a picker starts disagreeing with the
 * rule the server holds both of them to.
 */
export function PersonPicker({
  label,
  nobody,
  projectId,
  value,
  was,
  disabled = false,
  problem,
  onChange,
}: PersonPickerProps): React.JSX.Element {
  const crew = useProjectCrew(projectId);
  const offered = crew.data?.people ?? [];
  const listed = offered.some((person) => person.userId === value);

  const options = [
    { value: '', label: nobody },
    ...(was !== null && !listed
      ? [{ value: was.userId, label: `${was.displayName} · not on this project` }]
      : []),
    ...offered.map((person) => ({ value: person.userId, label: person.displayName })),
  ];

  return (
    <Select
      label={label}
      options={options}
      value={value}
      disabled={disabled}
      problem={problem}
      onChange={onChange}
    />
  );
}
