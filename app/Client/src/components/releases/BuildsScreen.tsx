import { useState } from 'react';
import { ScreenHeader } from '../shell/ScreenHeader.js';
import {
  describeFileSize,
  describeReleaseKind,
  type BuildsView,
  type Release,
  type ReleaseSync,
} from '@lpm/shared';

import { describeFailure } from '../../api/failure-messages.js';
import {
  Button,
  ButtonIcon,
  DownloadIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  useDisplay,
} from '../ui/index.js';
import { formatCalendarDate } from '../../logic/projects/index.js';
import { renderMarkdown } from '../../logic/markdown/index.js';
import { LoadingProject } from '../shell/LoadingProject.js';
import { ProjectShell } from '../shell/ProjectShell.js';
import { RepositorySynced, SyncFromRepository } from '../forge/RepositorySync.js';
import { ReleaseDialog } from './ReleaseDialog.js';
import { useBuilds, useDeleteRelease, useSyncReleases } from '../../logic/releases/use-releases.js';
import styles from './BuildsScreen.module.css';

/**
 * What this project has actually shipped.
 *
 * The latest release is the headline, because the question this page is opened
 * with is nearly always the same one — what did we last give people, and what
 * is in it. Everything before it is two lines down the side.
 *
 * Releases only. There was a second half listing every build run, filled in by
 * a fourteen-field form, because the GitHub App reads releases and not workflow
 * runs. Asking a studio to hand-copy its CI in order to look at it is asking
 * for something nobody does twice, and a build history only as current as the
 * last time somebody typed is worse than none, because it is read as current.
 */
export function BuildsScreen({ slug }: { slug: string }): React.JSX.Element {
  const builds = useBuilds(slug);

  if (builds.isPending) {
    return <LoadingProject slug={slug} active="builds" />;
  }

  if (builds.isError) {
    return (
      <p className={styles.problem} role="alert">
        {describeFailure(builds.error)}
      </p>
    );
  }

  return <Builds view={builds.data} />;
}

function Builds({ view }: { view: BuildsView }): React.JSX.Element {
  /** The release being written, or `'new'` for one that does not exist yet. */
  const [editing, setEditing] = useState<Release | 'new' | null>(null);

  return (
    <ProjectShell project={view.project} active="builds">
      <div className={styles.screen}>
        <ScreenHeader
          title="Releases"
          facts={
            <>
              <span>{countReleases(view)}</span>
              <RepositorySynced sync={view.sync} />
            </>
          }
          actions={
            <>
              <ReSync projectId={view.project.id} sync={view.sync} />
              <Button
                tone="go"
                aria-label="Record a release"
                title="Record a release"
                onClick={() => {
                  setEditing('new');
                }}
              >
                <ButtonIcon>
                  <PlusIcon size={14} />
                </ButtonIcon>
              </Button>
            </>
          }
        />

        <div className={styles.body}>
          {view.latest === null ? (
            <p className={styles.empty}>
              Nothing shipped yet. Record a release when there is a build somebody outside the team
              has — the tag, what changed, and where to download it.
            </p>
          ) : (
            <>
              <Latest
                release={view.latest}
                canWrite={view.canWrite}
                onEdit={() => {
                  setEditing(view.latest);
                }}
              />

              <Earlier
                releases={view.earlier}
                canWrite={view.canWrite}
                onEdit={(release) => {
                  setEditing(release);
                }}
              />
            </>
          )}
        </div>

        {editing !== null && (
          <ReleaseDialog
            projectId={view.project.id}
            release={editing === 'new' ? null : editing}
            onDone={() => {
              setEditing(null);
            }}
          />
        )}
      </div>
    </ProjectShell>
  );
}

/**
 * Reads the repository's releases in.
 *
 * The same control the board has, rather than the words `Re-sync` this page
 * used to carry: the two are asking the same thing of the same connection, and
 * a button that looks different says it is a different thing.
 */
function ReSync({
  projectId,
  sync,
}: {
  projectId: string;
  sync: ReleaseSync | null;
}): React.JSX.Element | null {
  const syncing = useSyncReleases();
  const { showInfo } = useDisplay();

  return (
    <SyncFromRepository
      sync={sync}
      what="releases"
      isReading={syncing.isPending}
      onRead={(repoFullName) => {
        syncing.mutate(
          { projectId },
          {
            onSuccess: () => {
              // What arrived is on the page behind this; the note only says the
              // asking finished, because a page that already looked right gives
              // no other sign that anything happened.
              showInfo(`Read the releases of ${repoFullName}.`);
            },
          },
        );
      }}
    />
  );
}

/** How many there are, said the way a person would say it. */
function countReleases(view: BuildsView): string {
  const total = view.earlier.length + (view.latest === null ? 0 : 1);

  return total === 1 ? '1 release' : `${String(total)} releases`;
}

/**
 * The release at the top of the page.
 *
 * The tag reads largest, because that is what somebody says out loud when they
 * ask which build a bug was found on.
 */
function Latest({
  release,
  canWrite,
  onEdit,
}: {
  release: Release;
  canWrite: boolean;
  onEdit: () => void;
}): React.JSX.Element {
  const kind = describeReleaseKind(release);

  return (
    <section className={styles.latest} aria-label={`Latest release ${release.tag}`}>
      <div className={styles.notesColumn}>
        <div className={styles.latestLabel}>
          <span className={styles.sectionLabel}>Latest release</span>
          {release.runLabel !== null && <span className={styles.run}>{release.runLabel}</span>}
        </div>

        <div className={styles.tagLine}>
          <span className={styles.tag}>{release.tag}</span>
          <span className={styles.kind} data-kind={kind}>
            {kind}
          </span>
          <span className={styles.releaseName}>{release.name}</span>
        </div>

        <div className={styles.facts}>
          {release.commitSha !== null && <span>{release.commitSha}</span>}
          <span>{formatCalendarDate(release.publishedOn)}</span>
          <span>{release.author}</span>
        </div>

        <Notes notes={release.notes} />

        {canWrite && (
          <div className={styles.latestActions}>
            <button type="button" className={styles.plain} onClick={onEdit}>
              Edit release
            </button>
            {release.url !== null && (
              <a className={styles.plain} href={release.url} target="_blank" rel="noreferrer">
                Open on GitHub
              </a>
            )}
          </div>
        )}
      </div>

      <div className={styles.sideColumn}>
        <Downloads release={release} />
      </div>
    </section>
  );
}

/**
 * What changed, as it was written.
 *
 * Markdown, rendered the way a card description and the design document are:
 * the headings a studio puts in a changelog are its own, and three this product
 * picked would be three everybody works around.
 */
function Notes({ notes }: { notes: string }): React.JSX.Element {
  if (notes.trim() === '') {
    return <p className={styles.noNotes}>No notes written for this one.</p>;
  }

  return (
    <div
      className={styles.notes}
      // Sanitised in `renderMarkdown`.
      dangerouslySetInnerHTML={{ __html: renderMarkdown(notes) }}
    />
  );
}

function Downloads({ release }: { release: Release }): React.JSX.Element {
  return (
    <div className={styles.side}>
      <span className={styles.sideLabel}>Downloads</span>

      {release.assets.length === 0 ? (
        <p className={styles.noNotes}>None listed.</p>
      ) : (
        <ul className={styles.downloads}>
          {release.assets.map((asset) => (
            <li key={asset.id} className={styles.download}>
              <span className={styles.downloadName}>{asset.name}</span>
              <span className={styles.downloadSize}>{describeFileSize(asset.sizeBytes)}</span>
              <GetIt asset={asset} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The way to actually have the file.
 *
 * The arrow used to be a unit on the download count — `38 ↓` — which read as a
 * button and was not one, on the page whose whole job is handing somebody a
 * build. Now it is the button, and the count has gone: what a row is for is
 * getting the file, not reporting how often other people did.
 *
 * Absent rather than disabled when nothing knows where the file is. A release
 * typed by hand with no link, or synced from a forge that did not say, has
 * nothing to press — and a dead control on the row is worse than a row that
 * simply does not offer one.
 *
 * A plain link rather than anything clever: the browser knows how to download,
 * and `download` asks it to save rather than navigate. `rel` because the file
 * is on somebody else's host.
 */
function GetIt({ asset }: { asset: Release['assets'][number] }): React.JSX.Element | null {
  if (asset.downloadUrl === null) return null;

  return (
    <a
      className={styles.getIt}
      href={asset.downloadUrl}
      download
      rel="noreferrer noopener"
      aria-label={`Download ${asset.name}`}
      title={`Download ${asset.name}`}
    >
      <DownloadIcon size={14} />
    </a>
  );
}

/**
 * Everything shipped before the latest one.
 *
 * Two lines each. A studio scanning this is looking for when something went
 * out, not reading its changelog again — that is what opening it is for.
 */
function Earlier({
  releases,
  canWrite,
  onEdit,
}: {
  releases: readonly Release[];
  canWrite: boolean;
  onEdit: (release: Release) => void;
}): React.JSX.Element | null {
  const remove = useDeleteRelease();
  const { askToConfirm } = useDisplay();

  if (releases.length === 0) {
    return null;
  }

  return (
    <section className={styles.earlier} aria-label="Earlier releases">
      <span className={styles.sectionLabel}>Earlier releases</span>

      <ul className={styles.history}>
        {releases.map((release) => (
          <li key={release.id} className={styles.historyRow}>
            <span className={styles.historyTag}>{release.tag}</span>
            <span className={styles.historyName}>{release.name}</span>
            <span className={styles.historyKind} data-kind={describeReleaseKind(release)}>
              {describeReleaseKind(release)}
            </span>
            <span className={styles.historyDate}>{formatCalendarDate(release.publishedOn)}</span>

            {canWrite && (
              <>
                {/* Marked rather than spelled out, and borderless rather
                    than a filled button: this is a row in a history list, and
                    two pills per row down a page of them would weigh more than
                    the releases they belong to. Same size as the words were. */}
                <button
                  type="button"
                  className={styles.rowMark}
                  aria-label={`Edit ${release.tag}`}
                  title={`Edit ${release.tag}`}
                  onClick={() => {
                    onEdit(release);
                  }}
                >
                  <PencilIcon size={14} />
                </button>

                <button
                  type="button"
                  className={styles.rowMarkStop}
                  aria-label={`Delete ${release.tag}`}
                  title={`Delete ${release.tag}`}
                  onClick={() => {
                    void (async () => {
                      const said = await askToConfirm({
                        question: `Delete ${release.tag}?`,
                        consequence:
                          release.assets.length === 0
                            ? 'The release comes off this page. Nothing else is touched.'
                            : `The release and the ${String(release.assets.length)} downloads listed under it come off this page. The files themselves are wherever they were.`,
                      });

                      if (!said) return;

                      remove.mutate({ releaseId: release.id }, {});
                    })();
                  }}
                >
                  <TrashIcon size={14} />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
