import { Link } from '@tanstack/react-router';

import {
  describeProjectSection,
  type ProjectSection,
  type ProjectWorkspaceView,
  type WorkspaceCategory,
} from '@lpm/shared';

import { AccountButton } from '../account/AccountButton.js';
import { NotificationMark } from '../account/NotificationMark.js';
import { useRealtimeInvalidation } from '../../logic/realtime/index.js';
import type { OutlineEntry } from '../../logic/markdown/document-outline.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import {
  AssetsIcon,
  BudgetIcon,
  BuildsIcon,
  CollapseIcon,
  DashboardIcon,
  DocsIcon,
  SettingsIcon,
  TasksIcon,
  TimelineIcon,
} from './nav-icons.js';
import { useSidebarCollapsed } from '../../logic/shell/use-sidebar-collapsed.js';
import { useWorkspace } from '../../logic/shell/use-workspace.js';
import styles from './ProjectShell.module.css';

export type { ProjectSection };

/**
 * The workspace, and where each screen sits in it.
 *
 * An icon rather than the prototype's number, because the sidebar collapses to
 * its icons and a `02` on its own says nothing. The order is the prototype's.
 */
/**
 * The doors, in the order they are drawn.
 *
 * The words come from `describeProjectSection` rather than from here, because
 * the settings screen lists the same six to switch off and a second copy of
 * `board` is "Tasks" is a copy that eventually disagrees.
 */
const SECTIONS: readonly {
  readonly id: ProjectSection;
  readonly label: string;
  readonly icon: () => React.JSX.Element;
}[] = (
  [
    ['dashboard', DashboardIcon],
    ['assets', AssetsIcon],
    ['board', TasksIcon],
    ['timeline', TimelineIcon],
    ['builds', BuildsIcon],
    ['budget', BudgetIcon],
    ['docs', DocsIcon],
    ['settings', SettingsIcon],
  ] as const satisfies readonly (readonly [ProjectSection, () => React.JSX.Element])[]
).map(([id, icon]) => ({ id, label: describeProjectSection(id), icon }));

/**
 * The sections to draw, which is every one this person may open.
 *
 * The server decides it, on the query the sidebar already asks for its counts.
 * Working it out here from a role would be the guess permission groups exist to
 * replace, and it has to be answered per project rather than per install: a
 * rule can allow something to somebody on a project and not to somebody in a
 * team on it.
 *
 * Every one of them until the answer arrives. It is a moment on the first visit
 * to a project and nothing at all afterwards — and a sidebar that filled in
 * would be a sidebar taking doors away in front of somebody, which is worse to
 * watch than one that never offered them. Nothing is granted either way: press
 * one in that moment and the screen behind it refuses exactly as it does now.
 */
function sectionsToDraw(workspace: ProjectWorkspaceView | undefined): typeof SECTIONS {
  if (workspace === undefined) return SECTIONS;

  return SECTIONS.filter((section) => workspace.sections.includes(section.id));
}

export interface ProjectShellProps {
  readonly project: { readonly id: string; readonly name: string; readonly slug: string };
  readonly active: ProjectSection;
  /**
   * The document's headings, when the screen showing has any.
   *
   * Passed in rather than read here: the outline comes off the same render
   * pass that put the anchors on the headings, and re-deriving it in the
   * sidebar is how a contents list comes to point at anchors that moved.
   */
  readonly outline?: readonly OutlineEntry[];
  readonly children: React.ReactNode;
}

/**
 * The frame every project screen sits in.
 *
 * Every screen in a project used to carry its own set of links to the others
 * in its header, which is how a product ends up with a different way of
 * getting to the same place from every page.
 *
 * It narrows to its icons on request, because a board is a screen people want
 * every pixel of and the sidebar is furniture the rest of the time.
 */
export function ProjectShell({
  project,
  active,
  outline,
  children,
}: ProjectShellProps): React.JSX.Element {
  // Here rather than on the board, which is where it used to be: the library
  // and the settings screen are as much a view of a project as the board is,
  // and one of them silently not keeping up is worse than none of them doing.
  useRealtimeInvalidation(project.id);

  const [isCollapsed, toggleCollapsed] = useSidebarCollapsed();
  const workspace = useWorkspace(project.slug);

  return (
    <div className={styles.shell}>
      <nav
        className={joinClassNames(styles.sidebar, isCollapsed && styles.sidebarCollapsed)}
        aria-label="Project"
      >
        <ProjectBadge
          project={project}
          logoUrl={workspace.data?.project.logoUrl ?? null}
          isCollapsed={isCollapsed}
          onToggle={toggleCollapsed}
        />

        {/* The part that scrolls. A long document's contents list can be taller
            than the window, and a nav that grows past the bottom of the screen
            takes the way out of the project with it. */}
        <div className={styles.sidebarScroll}>
          <div className={styles.group}>
            <span className={styles.groupLabel}>Workspace</span>
            {sectionsToDraw(workspace.data).map((section) => (
              <SectionLink
                key={section.id}
                section={section}
                slug={project.slug}
                isActive={section.id === active}
                badge={badgeFor(section.id, workspace.data)}
              />
            ))}
          </div>

          {/* Only while the library is open, and only while there is room to
            read it. The tree is that screen's table of contents: beside the
            task board it lists places that are not on the screen, and narrowed
            to its icons it is a column of anonymous squares. */}
          {active === 'assets' &&
            !isCollapsed &&
            workspace.data !== undefined &&
            workspace.data.categories.length > 0 && (
              <CategoryTree slug={project.slug} categories={workspace.data.categories} />
            )}

          {/* The document's own headings, on the same terms as the categories:
            only on the screen they belong to, and only while there is room to
            read them. */}
          {active === 'docs' && !isCollapsed && outline !== undefined && outline.length > 0 && (
            <DocumentOutline outline={outline} />
          )}
        </div>

        <SignedInAs />
      </nav>

      <div className={styles.content}>{children}</div>
    </div>
  );
}

/**
 * The mark in the corner, and the name beside it.
 *
 * The logo when the project has one, and the first letter of its name when it
 * does not — which is what every project looked like before one could be
 * chosen. It comes from the sidebar's own query rather than from the screen
 * underneath: the mark is drawn on all of them, and a screen with no reason to
 * ask a project for its picture would draw a letter instead.
 */
function ProjectBadge({
  project,
  logoUrl,
  isCollapsed,
  onToggle,
}: {
  project: { name: string; slug: string };
  logoUrl: string | null;
  isCollapsed: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <div className={styles.project}>
      {logoUrl === null ? (
        <span className={styles.projectMark} aria-hidden>
          {project.name.charAt(0).toUpperCase()}
        </span>
      ) : (
        <img className={styles.projectMark} src={logoUrl} alt="" />
      )}

      <span className={styles.projectNames}>
        <span className={styles.projectName}>{project.name}</span>
        {/* The way back out. Every screen had its own before this. */}
        <Link to="/" className={styles.switchProject}>
          Switch project
        </Link>
      </span>

      <button
        type="button"
        className={styles.collapse}
        // The button is the same button in both states, so its name does not
        // change with them. What changes is what it will do, and `aria-expanded`
        // is the thing that says which.
        aria-label="Sidebar"
        aria-expanded={!isCollapsed}
        title={isCollapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
        onClick={onToggle}
      >
        <CollapseIcon isCollapsed={isCollapsed} />
      </button>
    </div>
  );
}

/**
 * The number beside a section's name.
 *
 * Only where there is a number worth having: `Assets` counts the library and
 * `Tasks` counts what is still open. A badge on `Settings` would be a badge
 * counting settings.
 *
 * Nothing at all until the numbers arrive, rather than a zero — a zero that
 * turns into eight reads as work appearing out of nowhere.
 */
function badgeFor(
  section: ProjectSection,
  workspace: { assetCount: number; openCardCount: number } | undefined,
): number | null {
  if (workspace === undefined) {
    return null;
  }

  if (section === 'assets') {
    return workspace.assetCount;
  }

  return section === 'board' ? workspace.openCardCount : null;
}

function SectionLink({
  section,
  slug,
  isActive,
  badge,
}: {
  section: (typeof SECTIONS)[number];
  slug: string;
  isActive: boolean;
  badge: number | null;
}): React.JSX.Element {
  const className = joinClassNames(styles.navItem, isActive && styles.navItemActive);

  return (
    <Link to={pathFor(section.id)} params={{ slug }} className={className} title={section.label}>
      <NavLabel section={section} badge={badge} />
    </Link>
  );
}

/** Every address the nav can send somebody to. */
type SectionPath =
  | '/p/$slug'
  | '/p/$slug/assets'
  | '/p/$slug/tasks'
  | '/p/$slug/timeline'
  | '/p/$slug/builds'
  | '/p/$slug/budget'
  | '/p/$slug/doc'
  | '/p/$slug/settings';

/**
 * Where each section lives.
 *
 * The paths are written out rather than built from the section's name, because
 * the router's types know every route it has and a template literal would give
 * that up for nothing — and because two of them do not match their name anyway:
 * the board is at `tasks` and the design doc is at `doc`.
 *
 * A switch with no default, so a section added without an address here is a
 * compile error. This was eight near-identical `if` blocks ending in a bare
 * fallback to the board, which meant `builds` shipped pointing at the task
 * board and nothing said so until the end-to-end suite tripped over it.
 */
function pathFor(section: ProjectSection): SectionPath {
  switch (section) {
    case 'dashboard':
      return '/p/$slug';
    case 'assets':
      return '/p/$slug/assets';
    case 'board':
      return '/p/$slug/tasks';
    case 'timeline':
      return '/p/$slug/timeline';
    case 'builds':
      return '/p/$slug/builds';
    case 'budget':
      return '/p/$slug/budget';
    case 'docs':
      return '/p/$slug/doc';
    case 'settings':
      return '/p/$slug/settings';
  }
}

/**
 * The icon, and the word beside it.
 *
 * When the sidebar is narrow the word is clipped rather than removed, so the
 * link keeps the name a screen reader announces it by. `display: none` would
 * take that name away and leave a nav of unlabelled pictures.
 */
function NavLabel({
  section,
  badge,
}: {
  section: (typeof SECTIONS)[number];
  badge: number | null;
}): React.JSX.Element {
  // Capitalised locally because JSX reads a lowercase tag as an HTML element;
  // the property itself is `icon`, like every other property in the codebase.
  const { icon: Icon } = section;

  return (
    <>
      <span className={styles.navIcon}>
        <Icon />
      </span>
      <span className={styles.navText}>{section.label}</span>
      {/* Clipped away with the words when the sidebar narrows: a bare number
          against an icon says nothing about what it counts. */}
      {badge !== null && <span className={styles.navBadge}>{String(badge)}</span>}
    </>
  );
}

/**
 * The project's categories, as the design has them under the nav.
 *
 * A table of contents rather than a second filter: the library is one long
 * page grouped by category, and this is how somebody gets to the part of it
 * they came for without scrolling past four other headings. Which is also why
 * it is drawn only while that page is open.
 *
 * Sub-categories are indented under the category they are inside, as deep as
 * the library goes. The depth arrives with each row rather than being worked out
 * here: the query walks the tree, and a nav that re-derived the shape would be a
 * second opinion about it.
 */
function CategoryTree({
  slug,
  categories,
}: {
  slug: string;
  categories: readonly WorkspaceCategory[];
}): React.JSX.Element {
  return (
    <div className={styles.group}>
      <span className={styles.groupLabel}>Categories</span>

      {categories.map((category) => (
        <Link
          key={category.id}
          to="/p/$slug/assets"
          params={{ slug }}
          hash={`category-${category.id}`}
          className={styles.categoryItem}
          style={
            {
              '--category-depth': category.depth,
              '--category-color': category.color,
            } as React.CSSProperties
          }
          title={category.name}
        >
          <span className={styles.navText}>{category.name}</span>
          <span className={styles.navBadge}>{String(category.count)}</span>
        </Link>
      ))}
    </div>
  );
}

/**
 * The document's headings, as somewhere to go.
 *
 * A contents list rather than a set of links: the document is already on the
 * screen, so pressing one moves the page rather than loading anything. Smoothly,
 * because a jump gives no sense of how far you went — and instantly for anybody
 * who has asked their system not to animate things.
 */
function DocumentOutline({ outline }: { outline: readonly OutlineEntry[] }): React.JSX.Element {
  const goTo = (slug: string): void => {
    const heading = document.getElementById(slug);

    if (heading === null) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    heading.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <div className={styles.group}>
      <span className={styles.groupLabel}>Contents</span>

      {outline.map((entry) => (
        <button
          key={entry.slug}
          type="button"
          className={styles.outlineItem}
          data-level={entry.level}
          title={entry.text}
          onClick={() => {
            goTo(entry.slug);
          }}
        >
          <span className={styles.navText}>{entry.text}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Who is signed in, at the bottom where the prototype puts it.
 *
 * It said who you were and did nothing. It opens the account window now, which
 * is the only way into your own password on a screen inside a project — and on
 * a real install, the only way in at all for somebody who cannot reach the
 * Users screen.
 */
function SignedInAs(): React.JSX.Element {
  return (
    <div className={styles.signedIn}>
      <AccountButton size="full" />
      {/* At the end of the row, so the name and face keep the width they had
          and the mark takes none when there is nothing waiting. */}
      <NotificationMark opens="up" />
    </div>
  );
}
