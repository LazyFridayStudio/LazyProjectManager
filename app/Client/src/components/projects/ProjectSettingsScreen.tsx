import {
  describeProjectPhase,
  PROJECT_PHASES,
  type ProjectDetailView,
  type ProjectPhase,
  type ProjectSummary,
} from '@lpm/shared';
import type { UseMutationResult } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';

import { describeFailure, readFieldProblems } from '../../api/failure-messages.js';
import { Button, Field, Select, useDisplay } from '../ui/index.js';
import {
  formatMoney,
  formatTimeAgo,
  toMinorUnits,
} from '../../logic/projects/format-project-values.js';
import { LoadingProject } from '../shell/LoadingProject.js';
import { ProjectShell } from '../shell/ProjectShell.js';
import { ScreenHeader } from '../shell/ScreenHeader.js';
import { OpenIssuesOnly } from './OpenIssuesOnly.js';
import { ProjectSectionsPanel } from './ProjectSectionsPanel.js';
import { ProjectTeamPanel } from './ProjectTeamPanel.js';
import { RepositorySection } from './RepositorySection.js';
import { RepositorySetupHelp } from './RepositorySetupHelp.js';
import { SyncEvery } from './SyncEvery.js';
import styles from './ProjectSettingsScreen.module.css';
import { useSetKeyArt, useSetProjectLogo } from '../../logic/projects/use-project-pictures.js';
import {
  useProject,
  useSetProjectArchived,
  useUpdateProject,
} from '../../logic/projects/use-projects.js';

const PHASE_OPTIONS = PROJECT_PHASES.map((phase) => ({
  value: phase,
  label: describeProjectPhase(phase),
}));

/** Whole dollars, because that is the unit the budget is typed in. */
const MINOR_UNITS_PER_MAJOR = 100;

export function ProjectSettingsScreen({ slug }: { slug: string }): React.JSX.Element {
  const project = useProject(slug);

  if (project.isPending) {
    return <LoadingProject slug={slug} active="settings" />;
  }

  if (project.isError) {
    return (
      <div className={styles.screen}>
        <BackToLauncher />
        <p className={styles.problem} role="alert">
          {describeFailure(project.error)}
        </p>
      </div>
    );
  }

  return <ProjectSettings detail={project.data} />;
}

function BackToLauncher(): React.JSX.Element {
  return (
    <Link to="/" className={styles.back}>
      ← All projects
    </Link>
  );
}

function ProjectSettings({ detail }: { detail: ProjectDetailView }): React.JSX.Element {
  const { project } = detail;
  const setArchived = useSetProjectArchived();
  const isArchived = project.archivedAt !== null;

  return (
    <ProjectShell project={project} active="settings">
      <div className={styles.screen}>
        <ScreenHeader
          title="Settings"
          facts={
            <>
              <span className={styles.code}>{project.code}</span>
              <span>Updated {formatTimeAgo(project.updatedAt)}</span>
              {isArchived && <span className={styles.archivedTag}>Archived</span>}
            </>
          }
          actions={
            /* The one thing done to the project rather than to a field of it,
               so it sits where Teams keeps Remove team rather than at the
               bottom of the last panel on a screen that scrolls. */
            <Button
              // One button doing two opposite jobs, so its colour does too.
              tone={isArchived ? 'go' : 'stop'}
              busy={setArchived.isPending}
              busyLabel="Working…"
              onClick={() => {
                setArchived.mutate({ projectId: project.id, archived: !isArchived });
              }}
            >
              {isArchived ? 'Restore project' : 'Archive project'}
            </Button>
          }
        />

        <div className={styles.body}>
          <ProjectDetailsForm detail={detail} />
          <ProjectAside detail={detail} />
          {/* Across the width, under both columns. It is the one panel here
              somebody works in rather than reads, and it is where every
              question about who can open this project is answered. */}
          <div className={styles.team}>
            <ProjectTeamPanel detail={detail} />
          </div>
        </div>
      </div>
    </ProjectShell>
  );
}

interface SettingsForm {
  name: string;
  engine: string;
  phase: ProjectPhase;
  budget: string;
  startsOn: string;
  shipsOn: string;
}

/**
 * Everything about a project a person can change.
 *
 * Sends every field on every save rather than only what was touched. The command
 * treats an absent field as "leave it", which is what makes concurrent edits to
 * different fields safe — but this form owns all of them, so claiming otherwise
 * would only hide a stale value.
 */
function ProjectDetailsForm({ detail }: { detail: ProjectDetailView }): React.JSX.Element {
  const { project } = detail;
  const [form, setForm] = useState<SettingsForm>(() => toForm(detail));
  const updateProject = useUpdateProject();
  const { showInfo } = useDisplay();
  const problems = readFieldProblems(updateProject.error);
  const isArchived = project.archivedAt !== null;

  // A refetch after saving, or after somebody else's change arrives, is the
  // authority on what the project is. Keying off `updatedAt` rather than the
  // whole object means typing is not interrupted by an identical refetch.
  useEffect(() => {
    setForm(toForm(detail));
  }, [detail.project.updatedAt]);

  const update =
    (field: keyof SettingsForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => {
      const { value } = event.target;
      setForm((current) => ({ ...current, [field]: value }));
    };

  const save = (): void => {
    updateProject.mutate(
      {
        projectId: project.id,
        name: form.name,
        engine: blankToNull(form.engine),
        phase: form.phase,
        budgetMinor: toMinorUnits(form.budget),
        startsOn: blankToNull(form.startsOn),
        shipsOn: blankToNull(form.shipsOn),
      },
      // Said in the corner, where a save that failed is already said. Both
      // halves of the same press reporting in two different places is the one
      // way to make a message harder to find than no message.
      {
        onSuccess: () => {
          showInfo('Project saved.');
        },
      },
    );
  };

  return (
    <form
      className={styles.section}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className={styles.panelHeading}>
        <h2 className={styles.panelTitle}>Project</h2>

        <span className={styles.headingAction}>
          <Button
            tone="go"
            type="submit"
            disabled={isArchived}
            busy={updateProject.isPending}
            busyLabel="Saving…"
          >
            Save changes
          </Button>
        </span>
      </div>

      <Field
        label="Project name"
        value={form.name}
        onChange={update('name')}
        disabled={isArchived}
        problem={problems.name}
      />

      <div className={styles.pair}>
        <Field
          label="Engine"
          placeholder="Unreal 5.5"
          value={form.engine}
          onChange={update('engine')}
          disabled={isArchived}
          problem={problems.engine}
        />
        <Select
          label="Phase"
          options={PHASE_OPTIONS}
          value={form.phase}
          onChange={update('phase')}
          disabled={isArchived}
          problem={problems.phase}
        />
      </div>

      <Field
        label="Budget"
        type="number"
        min={0}
        step={1}
        value={form.budget}
        onChange={update('budget')}
        disabled={isArchived}
        hint={`Currently ${formatMoney(project.budgetMinor, project.currency)}.`}
        problem={problems.budgetMinor}
      />

      <div className={styles.pair}>
        <Field
          label="Production start"
          type="date"
          value={form.startsOn}
          onChange={update('startsOn')}
          disabled={isArchived}
          problem={problems.startsOn}
        />
        <Field
          label="Target ship"
          type="date"
          value={form.shipsOn}
          onChange={update('shipsOn')}
          disabled={isArchived}
          problem={problems.shipsOn}
        />
      </div>

      <ProjectPictures project={project} />
    </form>
  );
}

/**
 * What the project is built from, beside the form that names it.
 *
 * A list that grows rather than a field somebody types in, which is why it is
 * here and not in the form. The team was in this column too until it gained the
 * controls that put somebody on the project; it spans the width below now,
 * because a panel with a search and a dropdown per row is not a list of short
 * facts.
 */
function ProjectAside({ detail }: { detail: ProjectDetailView }): React.JSX.Element {
  const { project } = detail;

  return (
    <div className={styles.aside}>
      <section className={styles.section}>
        <div className={styles.panelHeading}>
          <h2 className={styles.panelTitle}>Repository</h2>

          {/* Beside the heading rather than inside the panel, so it is there in
              every state — including the one where nothing is connected yet and
              the question is loudest. */}
          <span className={styles.headingAction}>
            <RepositorySetupHelp />
          </span>
        </div>

        <RepositorySection projectId={project.id} />
        <SyncEvery detail={detail} />
        <OpenIssuesOnly detail={detail} />
      </section>

      {/* Under Repository, because both are facts about the project rather than
          fields of it: what it is wired to, and which of its rooms it uses. */}
      <section className={styles.section}>
        <div className={styles.panelHeading}>
          <h2 className={styles.panelTitle}>Sections</h2>
        </div>

        <ProjectSectionsPanel detail={detail} />
      </section>
    </div>
  );
}

/**
 * The two pictures, at the bottom of the form with the fields that name them.
 *
 * Together rather than apart because they answer one question — what this
 * project looks like — and a studio setting up a new one sets both in the same
 * minute.
 */
function ProjectPictures({ project }: { project: ProjectSummary }): React.JSX.Element {
  return (
    <>
      <div className={styles.picture}>
        <span className={styles.pictureLabel}>Logo</span>
        <ProjectLogo project={project} />
      </div>

      <div className={styles.picture}>
        <span className={styles.pictureLabel}>Key art</span>
        <KeyArt project={project} />
      </div>
    </>
  );
}

/**
 * The square mark, which is what a project looks like where it is only named.
 *
 * A project without one is drawn as the first letter of its name, in the same
 * square the sidebar draws — so the preview here is the thing itself rather
 * than a picture of it, and choosing a logo changes both at once.
 */
function ProjectLogo({ project }: { project: ProjectSummary }): React.JSX.Element {
  const setLogo = useSetProjectLogo(project.id, project.slug);

  return (
    <ProjectPicture
      label="Logo"
      hint="Square. Shown wherever the project is named."
      upload={setLogo}
      preview={
        project.logoUrl === null ? (
          <span className={styles.logoPreview} aria-hidden>
            {project.name.charAt(0).toUpperCase()}
          </span>
        ) : (
          <img className={styles.logoPreview} src={project.logoUrl} alt="" />
        )
      }
    />
  );
}

/**
 * The image on the project's tile.
 *
 * A project has one, so choosing another replaces it. What it looks like on the
 * tile waits for thumbnails — a launcher that loaded the forty-megabyte source
 * file for every project would be a launcher nobody opens twice.
 */
function KeyArt({ project }: { project: ProjectSummary }): React.JSX.Element {
  const setKeyArt = useSetKeyArt(project.id, project.slug);

  return (
    <ProjectPicture
      label="Key art"
      hint="Wide. Shown on the launcher."
      upload={setKeyArt}
      preview={
        project.keyArtUrl === null ? (
          <span className={styles.keyArtPreview} aria-hidden>
            16:9
          </span>
        ) : (
          <img className={styles.keyArtPreview} src={project.keyArtUrl} alt="" />
        )
      }
    />
  );
}

/**
 * A picture the project is drawn with, and the button that replaces it.
 *
 * The current one sits beside the button rather than nowhere: an upload with
 * nothing to look at afterwards is an upload somebody does twice to check it
 * took. What it shows waits for the thumbnail, which is a second at most.
 */
function ProjectPicture({
  label,
  hint,
  preview,
  upload,
}: {
  label: string;
  hint: string;
  preview: React.ReactNode;
  upload: UseMutationResult<string, Error, File>;
}): React.JSX.Element {
  const picker = useRef<HTMLInputElement>(null);

  return (
    <div className={styles.pictureRow}>
      {preview}

      <Button
        busy={upload.isPending}
        busyLabel="Uploading…"
        onClick={() => {
          picker.current?.click();
        }}
      >
        Choose an image
      </Button>

      <span className={styles.message}>{upload.isSuccess ? `${label} set.` : hint}</span>

      <input
        ref={picker}
        type="file"
        accept="image/*"
        className={styles.hiddenPicker}
        aria-label={label}
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (file !== undefined) {
            upload.mutate(file);
          }

          // Cleared so choosing the same file twice in a row still fires.
          event.target.value = '';
        }}
      />
    </div>
  );
}

function toForm(detail: ProjectDetailView): SettingsForm {
  const { project } = detail;

  return {
    name: project.name,
    engine: project.engine ?? '',
    phase: project.phase,
    budget: project.budgetMinor === null ? '' : String(project.budgetMinor / MINOR_UNITS_PER_MAJOR),
    startsOn: project.startsOn ?? '',
    shipsOn: project.shipsOn ?? '',
  };
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
}
