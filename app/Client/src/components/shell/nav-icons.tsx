/**
 * The icons the nav is drawn with.
 *
 * Inline SVG rather than an icon font or a package: there is a handful of them,
 * they never change independently of this file, and a font would be a network
 * request and a flash of missing glyphs for a handful of shapes.
 *
 * All of them are 16×16, stroked rather than filled, and take their colour from
 * the text around them — so an item that is the current one turns its icon the
 * accent colour without anything here knowing that happened.
 */

const SHARED = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

/** Four panes of a summary: the shape of a dashboard from far enough away. */
export function DashboardIcon(): React.JSX.Element {
  return (
    <svg {...SHARED}>
      <rect x="2" y="2" width="5" height="5" />
      <rect x="9" y="2" width="5" height="5" />
      <rect x="2" y="9" width="5" height="5" />
      <rect x="9" y="9" width="5" height="5" />
    </svg>
  );
}

/** A crate: the library is a shelf of things that were made. */
export function AssetsIcon(): React.JSX.Element {
  return (
    <svg {...SHARED}>
      <path d="M8 1.9 14 4.9v6.2L8 14.1 2 11.1V4.9z" />
      <path d="M2 4.9 8 7.9l6-3" />
      <path d="M8 7.9v6.2" />
    </svg>
  );
}

/** Columns of different heights: a board, seen from far enough away. */
export function TasksIcon(): React.JSX.Element {
  return (
    <svg {...SHARED}>
      <rect x="2" y="2.6" width="3.4" height="10.8" rx="1" />
      <rect x="6.3" y="2.6" width="3.4" height="7.2" rx="1" />
      <rect x="10.6" y="2.6" width="3.4" height="4.4" rx="1" />
    </svg>
  );
}

/** A bar chart lying on its side, which is what the screen is. */
export function TimelineIcon(): React.JSX.Element {
  return (
    <svg {...SHARED}>
      <rect x="2" y="3" width="8" height="2.6" rx="1" />
      <rect x="4.6" y="6.7" width="9.4" height="2.6" rx="1" />
      <rect x="2" y="10.4" width="6.4" height="2.6" rx="1" />
    </svg>
  );
}

/** A stack of coins, seen from the side. */
export function BudgetIcon(): React.JSX.Element {
  return (
    <svg {...SHARED}>
      <ellipse cx="8" cy="4" rx="5.4" ry="2.2" />
      <path d="M2.6 4v3.4c0 1.2 2.4 2.2 5.4 2.2s5.4-1 5.4-2.2V4" />
      <path d="M2.6 7.6V11c0 1.2 2.4 2.2 5.4 2.2s5.4-1 5.4-2.2V7.6" />
    </svg>
  );
}

/** A crate on a pallet: something packed up and sent out. */
export function BuildsIcon(): React.JSX.Element {
  return (
    <svg {...SHARED}>
      <path d="M8 2.2 13.4 5v6L8 13.8 2.6 11V5z" />
      <path d="M2.6 5 8 7.8 13.4 5" />
      <path d="M8 7.8v6" />
    </svg>
  );
}

/** A page with writing on it. */
export function DocsIcon(): React.JSX.Element {
  return (
    <svg {...SHARED}>
      <path d="M3.4 2.2h6.2L12.6 5.2V13.8H3.4z" />
      <path d="M9.4 2.4v3h3" />
      <path d="M5.6 8.4h4.8M5.6 11h3.2" />
    </svg>
  );
}

/** Sliders: settings are things set to a value, not a machine with cogs. */
export function SettingsIcon(): React.JSX.Element {
  return (
    <svg {...SHARED}>
      <path d="M2 5h3.2M8.8 5H14M2 11h6.2M11.8 11H14" />
      <circle cx="7" cy="5" r="1.8" />
      <circle cx="10" cy="11" r="1.8" />
    </svg>
  );
}

/*
 * The five places outside a project.
 *
 * The same box and the same stroke as the ones above, because the two rows are
 * read by the same person minutes apart and a set that only half matches reads
 * as two sets. What separates them is what each place is, not how it is drawn.
 */

/** A picture in a frame: on the launcher a project is its key art. */
export function ProjectsIcon(): React.JSX.Element {
  return (
    <svg {...SHARED}>
      <rect x="2" y="3" width="12" height="10" rx="1.6" />
      <circle cx="5.7" cy="6.5" r="1.1" />
      <path d="M2.6 11.6 6 8.4l2.4 2.1 2.1-1.8 2.9 2.5" />
    </svg>
  );
}

/** Somebody, and somebody behind them: a team is more than one person. */
export function TeamsIcon(): React.JSX.Element {
  return (
    <svg {...SHARED}>
      <circle cx="6.1" cy="5.6" r="2.4" />
      <path d="M1.9 13.4c0-2.3 1.9-3.7 4.2-3.7s4.2 1.4 4.2 3.7" />
      <path d="M10.9 3.6a2.4 2.4 0 0 1 0 4" />
      <path d="M12.3 9.9c1.1.5 1.8 1.6 1.8 3.5" />
    </svg>
  );
}

/** A key: a permission group is what opens a door somebody could not open. */
export function PermissionsIcon(): React.JSX.Element {
  return (
    <svg {...SHARED}>
      <circle cx="5.7" cy="10.3" r="3.3" />
      <path d="M8 8 13.6 2.4" />
      <path d="M10.2 5.8 12 7.6" />
      <path d="M11.9 4.1 13.7 5.9" />
    </svg>
  );
}

/** A clock: the trail is what happened, and when it happened. */
export function AuditIcon(): React.JSX.Element {
  return (
    <svg {...SHARED}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.4V8l2.5 1.7" />
    </svg>
  );
}

/** One person, where a team is two: this is the screen of people one at a time. */
export function UsersIcon(): React.JSX.Element {
  return (
    <svg {...SHARED}>
      <circle cx="8" cy="5.3" r="2.7" />
      <path d="M2.9 13.4c0-2.6 2.3-4 5.1-4s5.1 1.4 5.1 4" />
    </svg>
  );
}

/**
 * Which way the sidebar is about to go.
 *
 * One icon that turns around rather than two, so the button is plainly the same
 * button in both states.
 */
export function CollapseIcon({ isCollapsed }: { isCollapsed: boolean }): React.JSX.Element {
  return (
    <svg {...SHARED} style={{ transform: isCollapsed ? 'scaleX(-1)' : undefined }}>
      <path d="M9.5 4 5.5 8l4 4" />
      <path d="M13 3v10" />
    </svg>
  );
}
