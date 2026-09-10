import type { ProjectSummary } from '@lpm/shared';
import { useMemo, useState } from 'react';

import { Button, ButtonIcon, PlusIcon } from '../ui/index.js';
import { InstallShell } from '../shell/InstallShell.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import styles from './LauncherScreen.module.css';
import { NewProjectDialog } from './NewProjectDialog.js';
import { ProjectTile } from './ProjectTile.js';
import { useProjectList } from '../../logic/projects/use-projects.js';

type LauncherFilter = 'active' | 'archived' | 'all';

const FILTER_LABELS: Readonly<Record<LauncherFilter, string>> = {
  active: 'Active',
  archived: 'Archived',
  all: 'All projects',
};

/**
 * The launcher: every project this person can open.
 *
 * One request fetches every project and the filtering happens here. A studio has
 * tens of projects rather than thousands, so a round trip per chip would buy
 * nothing and would make the counts on the chips a second source of truth.
 */
export function LauncherScreen(): React.JSX.Element {
  const projectList = useProjectList('all');
  const [filter, setFilter] = useState<LauncherFilter>('active');
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const projects = projectList.data?.projects ?? [];
  const counts = useMemo(() => countByFilter(projects), [projects]);
  const visible = useMemo(
    () => matchSearch(byFilter(projects, filter), search),
    [projects, filter, search],
  );

  return (
    <InstallShell
      active="projects"
      title="Projects"
      actions={
        <>
          <input
            className={styles.search}
            type="search"
            value={search}
            placeholder="Search projects…"
            aria-label="Search projects"
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
          {/* The mark rather than the words, on the same terms as the rest of
              the bar it sits in. This opens the dialog rather than being it —
              `Create project` inside is the button whose label is the sentence
              saying what is about to happen, and this one is an ordinary
              control that takes its mark. The words are its `aria-label` and
              its `title`, so a screen reader says it and a hover shows it. */}
          <Button
            tone="go"
            aria-label="New project"
            title="New project"
            onClick={() => {
              setIsCreating(true);
            }}
          >
            <ButtonIcon>
              <PlusIcon />
            </ButtonIcon>
          </Button>
        </>
      }
    >
      <LauncherFilters
        filter={filter}
        counts={counts}
        shown={visible.length}
        onFilter={setFilter}
      />

      {projectList.isPending && <p className={styles.message}>Loading projects…</p>}
      {projectList.isError && (
        <p className={styles.problem} role="alert">
          {projectList.error.message}
        </p>
      )}

      {!projectList.isPending && visible.length === 0 && (
        <p className={styles.message}>{describeEmpty(filter, search)}</p>
      )}

      <div className={styles.grid}>
        {visible.map((project) => (
          <ProjectTile key={project.id} project={project} />
        ))}

        {/* A tile rather than only the button in the header, because the slate
            is where somebody is looking when they decide they want another —
            and short, because it is an offer rather than a project. */}
        <button
          type="button"
          className={styles.newTile}
          onClick={() => {
            setIsCreating(true);
          }}
        >
          <span className={styles.newTileHeading}>+ New project</span>
          <span className={styles.newTileBody}>Start with an empty board.</span>
        </button>
      </div>

      {isCreating && (
        <NewProjectDialog
          onClose={() => {
            setIsCreating(false);
          }}
        />
      )}
    </InstallShell>
  );
}

interface LauncherFiltersProps {
  readonly filter: LauncherFilter;
  readonly counts: Record<LauncherFilter, number>;
  /** How many are on screen, which is the counts narrowed by the search. */
  readonly shown: number;
  readonly onFilter: (filter: LauncherFilter) => void;
}

/** Which slice of the slate to show, and how much of it there is. */
function LauncherFilters({
  filter,
  counts,
  shown,
  onFilter,
}: LauncherFiltersProps): React.JSX.Element {
  return (
    <div className={styles.filters}>
      {(Object.keys(FILTER_LABELS) as LauncherFilter[]).map((candidate) => (
        <button
          key={candidate}
          type="button"
          className={joinClassNames(styles.chip, filter === candidate && styles.chipSelected)}
          aria-pressed={filter === candidate}
          onClick={() => {
            onFilter(candidate);
          }}
        >
          <span>{FILTER_LABELS[candidate]}</span>
          <span className={styles.chipCount}>{counts[candidate]}</span>
        </button>
      ))}
      <span className={styles.total}>{shown} shown</span>
    </div>
  );
}

/** What an empty slate says, which depends on why it is empty. */
function describeEmpty(filter: LauncherFilter, search: string): string {
  if (search.trim() !== '') {
    return `Nothing matches “${search.trim()}”. Projects are found by name or by code.`;
  }

  if (filter === 'archived') {
    return 'Nothing is archived. A project archived from its settings screen shows up here.';
  }

  return 'No projects yet. The first one starts with an empty board and a code of its own.';
}

function byFilter(
  projects: readonly ProjectSummary[],
  filter: LauncherFilter,
): readonly ProjectSummary[] {
  if (filter === 'all') {
    return projects;
  }

  const wantArchived = filter === 'archived';

  return projects.filter((project) => (project.archivedAt !== null) === wantArchived);
}

function matchSearch(
  projects: readonly ProjectSummary[],
  search: string,
): readonly ProjectSummary[] {
  const needle = search.trim().toLowerCase();

  if (needle === '') {
    return projects;
  }

  // Name and code both, because people reach for whichever they remember.
  return projects.filter(
    (project) =>
      project.name.toLowerCase().includes(needle) || project.code.toLowerCase().includes(needle),
  );
}

function countByFilter(projects: readonly ProjectSummary[]): Record<LauncherFilter, number> {
  const archived = projects.filter((project) => project.archivedAt !== null).length;

  return { active: projects.length - archived, archived, all: projects.length };
}
