import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';

import { AssetLibraryScreen } from './components/assets/AssetLibraryScreen.js';
import { BudgetScreen } from './components/budget/BudgetScreen.js';
import { BuildsScreen } from './components/releases/BuildsScreen.js';
import { PermissionsScreen } from './components/permissions/PermissionsScreen.js';
import { DesignDocScreen } from './components/docs/DesignDocScreen.js';
import { DashboardScreen } from './components/dashboard/DashboardScreen.js';
import { AgentsScreen } from './components/users/AgentsScreen.js';
import { UsersScreen } from './components/users/UsersScreen.js';
import { TeamsScreen } from './components/teams/TeamsScreen.js';
import { AuditTrailScreen } from './components/audit/AuditTrailScreen.js';
import { DeletedThingsScreen } from './components/recovery/DeletedThingsScreen.js';
import { BoardScreen } from './components/board/BoardScreen.js';
import { SectionNotUsed, useSectionIsOff } from './components/shell/SectionNotUsed.js';
import { TaskListScreen } from './components/board/TaskListScreen.js';
import { LauncherScreen } from './components/projects/LauncherScreen.js';
import { ProjectSettingsScreen } from './components/projects/ProjectSettingsScreen.js';
import { TimelineScreen } from './components/timeline/TimelineScreen.js';

/**
 * The signed-in app's routes.
 *
 * A project is addressed by its slug, so a link to one can be pasted into a chat
 * and opened. That is the whole reason the slug exists, and it is why this is a
 * router rather than a piece of component state.
 *
 * Opening a project lands on its board, because that is the screen people spend
 * the day on; settings is a step off it rather than the front door.
 *
 * Routes are declared in code rather than generated from files: eight of them do
 * not justify a build step, and the tree is readable in one screen here.
 */
const rootRoute = createRootRoute({ component: Outlet });

const launcherRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LauncherScreen,
});

/*
 * Everybody on the install, and what each of them may do. Owner-only, like the
 * trail: the query behind it refuses anybody else, and the tab that leads here
 * is only drawn for the people it will answer.
 */
const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/users',
  component: UsersScreen,
});

/*
 * The agents, and how something outside the app reaches this install.
 *
 * Its own address rather than a tab held in state, for the reason the task
 * views have one: setting an agent up is a thing somebody is told to go and do,
 * and "open Users and press Agents" is a worse instruction than a link.
 */
const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/users/agents',
  component: AgentsScreen,
});

/* The teams, and who is in them. Admin-only for now, like the people. */
const teamsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/teams',
  component: TeamsScreen,
});

/* What each team may and may not do. Admin-only, like the teams themselves. */
const permissionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/permissions',
  component: PermissionsScreen,
});

/* The history of the install, and its own tab. */
const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/audit',
  component: AuditTrailScreen,
});

/* Under Audit rather than beside it: the same question a day apart. */
const deletedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/audit/deleted',
  component: DeletedThingsScreen,
});

/*
 * A project opens on its dashboard, as the design has it: the board is where
 * one person's week is, and the dashboard is what the project is doing.
 */
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$slug',
  component: DashboardRoute,
});

/*
 * A card can be addressed as well as the board it sits on.
 *
 * `?card=` says "open this one on arrival", which is what a notification needs:
 * it points at a card that may well be on a project the reader does not have
 * open, so the instruction has to survive a whole screen loading first. The
 * board clears it once it has been obeyed — the address is an instruction here,
 * not a mirror of what is on screen, and a card closed by hand should not leave
 * a stale link behind in the bar.
 *
 * Optional, so every other way onto the board is unchanged.
 */
const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$slug/tasks',
  component: BoardRoute,
  validateSearch: (search: Record<string, unknown>): { card?: string } =>
    typeof search.card === 'string' ? { card: search.card } : {},
});

/*
 * The same work, listed rather than laid out.
 *
 * Its own address rather than a tab held in state: somebody looking at every
 * task narrowed to a milestone can paste where they are, and the person opening
 * it sees the same thing.
 */
const taskListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$slug/tasks/all',
  component: TaskListRoute,
});

const assetLibraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$slug/assets',
  component: AssetLibraryRoute,
});

const timelineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$slug/timeline',
  component: TimelineRoute,
});

const buildsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$slug/builds',
  component: BuildsRoute,
});

const budgetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$slug/budget',
  component: BudgetRoute,
});

const designDocRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$slug/doc',
  component: DesignDocRoute,
});

const projectSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$slug/settings',
  component: ProjectSettingsRoute,
});

function DashboardRoute(): React.JSX.Element {
  const { slug } = dashboardRoute.useParams();

  return <DashboardScreen slug={slug} />;
}

function BoardRoute(): React.JSX.Element {
  const { slug } = boardRoute.useParams();
  const isOff = useSectionIsOff(slug, 'board');

  if (isOff) {
    return <SectionNotUsed slug={slug} section="board" />;
  }

  return <BoardScreen slug={slug} />;
}

function TaskListRoute(): React.JSX.Element {
  const { slug } = taskListRoute.useParams();
  const isOff = useSectionIsOff(slug, 'board');

  if (isOff) {
    return <SectionNotUsed slug={slug} section="board" />;
  }

  return <TaskListScreen slug={slug} />;
}

function AssetLibraryRoute(): React.JSX.Element {
  const { slug } = assetLibraryRoute.useParams();
  const isOff = useSectionIsOff(slug, 'assets');

  if (isOff) {
    return <SectionNotUsed slug={slug} section="assets" />;
  }

  return <AssetLibraryScreen slug={slug} />;
}

function TimelineRoute(): React.JSX.Element {
  const { slug } = timelineRoute.useParams();
  const isOff = useSectionIsOff(slug, 'timeline');

  if (isOff) {
    return <SectionNotUsed slug={slug} section="timeline" />;
  }

  return <TimelineScreen slug={slug} />;
}

function BuildsRoute(): React.JSX.Element {
  const { slug } = buildsRoute.useParams();
  const isOff = useSectionIsOff(slug, 'builds');

  if (isOff) {
    return <SectionNotUsed slug={slug} section="builds" />;
  }

  return <BuildsScreen slug={slug} />;
}

function BudgetRoute(): React.JSX.Element {
  const { slug } = budgetRoute.useParams();
  const isOff = useSectionIsOff(slug, 'budget');

  if (isOff) {
    return <SectionNotUsed slug={slug} section="budget" />;
  }

  return <BudgetScreen slug={slug} />;
}

function DesignDocRoute(): React.JSX.Element {
  const { slug } = designDocRoute.useParams();
  const isOff = useSectionIsOff(slug, 'docs');

  if (isOff) {
    return <SectionNotUsed slug={slug} section="docs" />;
  }

  return <DesignDocScreen slug={slug} />;
}

function ProjectSettingsRoute(): React.JSX.Element {
  const { slug } = projectSettingsRoute.useParams();

  return <ProjectSettingsScreen slug={slug} />;
}

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    launcherRoute,
    usersRoute,
    agentsRoute,
    teamsRoute,
    permissionsRoute,
    auditRoute,
    deletedRoute,
    dashboardRoute,
    boardRoute,
    taskListRoute,
    assetLibraryRoute,
    timelineRoute,
    buildsRoute,
    budgetRoute,
    designDocRoute,
    projectSettingsRoute,
  ]),
  // The signed-out screens are rendered above the router, so an unknown address
  // lands on the launcher rather than on a dead end.
  defaultNotFoundComponent: LauncherScreen,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
