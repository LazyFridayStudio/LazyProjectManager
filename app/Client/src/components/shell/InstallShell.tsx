import { Link } from '@tanstack/react-router';

import { AccountButton } from '../account/AccountButton.js';
import { AuditIcon, PermissionsIcon, ProjectsIcon, TeamsIcon, UsersIcon } from './nav-icons.js';
import { NotificationMark } from '../account/NotificationMark.js';
import { ScreenHeader } from './ScreenHeader.js';
import { useMay } from '../../logic/auth/use-identity.js';
import styles from './InstallShell.module.css';

export type InstallTab = 'projects' | 'teams' | 'permissions' | 'audit' | 'users';

export interface InstallShellProps {
  readonly active: InstallTab;
  /** What the screen is called. Its `<h1>`, read out rather than drawn. */
  readonly title: string;
  /** The screen's own controls: a search box, a New something. */
  readonly actions?: React.ReactNode;
  readonly children: React.ReactNode;
}

/**
 * Everything outside a project, drawn the same way every time.
 *
 * The same bar the asset library and the board have — `ScreenHeader` — with the
 * row of places where a title would be. The place you are is named; the places
 * you could go are marks. So the row still says what this screen is — the word
 * beside the current tab is the title, rather than a heading repeating
 * underneath the tab somebody just pressed — and the other four spend a mark
 * each on themselves instead of a word at title size.
 *
 * Five words at that size were the loudest thing on a screen whose content is
 * set smaller than its navigation, and `Permissions` alone was eleven
 * characters of chrome on every screen outside a project. Marks are also what
 * these five are to somebody who crosses them dozens of times a day and stopped
 * reading them after the first — which is the same argument the sidebar is
 * drawn on, and the one the library's category controls were rebuilt on.
 *
 * No facts line and no sentence explaining the screen. How many teams there
 * are is on the screen already, in the teams; what a role decides is on the
 * screen already, in the roles. A header repeating either spends a line on
 * words instead of on the thing.
 *
 * Your own account sits at the far end, past the screen's own actions and a
 * divider: it is not another place to go, so it is not in the row of places.
 *
 * It used to be two buttons — Change password and Sign out — which spent the end
 * of every screen on two things somebody does rarely, and put the password
 * behind a header most people on an install cannot reach. Both are inside the
 * account window now, and what is left is your picture.
 *
 * `ProjectShell` does the same job inside a project.
 */
export function InstallShell({
  active,
  title,
  actions,
  children,
}: InstallShellProps): React.JSX.Element {
  const may = useMay();

  return (
    <div className={styles.screen}>
      <ScreenHeader
        title={title}
        lead={
          <nav className={styles.tabs} aria-label="Install">
            <Tab to="/" name="Projects" icon={ProjectsIcon} isActive={active === 'projects'} />
            {/* Each tab asks for the action its own screen asserts, so a tab
                and the screen behind it cannot disagree about who may be
                there. */}
            {may('team.view') && (
              <Tab to="/teams" name="Teams" icon={TeamsIcon} isActive={active === 'teams'} />
            )}
            {may('team.view') && (
              <Tab
                to="/permissions"
                name="Permissions"
                icon={PermissionsIcon}
                isActive={active === 'permissions'}
              />
            )}
            {may('audit.view') && (
              <Tab to="/audit" name="Audit" icon={AuditIcon} isActive={active === 'audit'} />
            )}
            {may('user.view') && (
              <Tab to="/users" name="Users" icon={UsersIcon} isActive={active === 'users'} />
            )}
          </nav>
        }
        actions={
          <>
            {actions}
            <span className={styles.divider} aria-hidden />
            {/* Before the face rather than on it: the two lead different
                places, and this one is the only thing in the chrome that
                somebody else put there. */}
            <NotificationMark opens="down" />
            <AccountButton size="compact" />
          </>
        }
      />

      <div className={styles.body}>{children}</div>
    </div>
  );
}

interface TabProps {
  readonly to: '/' | '/teams' | '/permissions' | '/audit' | '/users';
  readonly name: string;
  readonly icon: () => React.JSX.Element;
  readonly isActive: boolean;
}

/**
 * One place you can be.
 *
 * A mark, and the word too when this is the one you are on — which is the same
 * shape the sidebar has when it is narrowed, and the reason the row can stop
 * saying all five: the screen is still named, by the tab naming it. The word is
 * set at the size a screen title is set at, because that is the job it is doing.
 *
 * The name is carried whatever is drawn. `aria-label` says it to a screen reader
 * and `title` shows it on a hover, so a mark somebody has not learnt yet is one
 * press away from telling them what it is — and the marks the prototype would
 * have replaced with `01 02 03` are still not numbers, which read as a step in
 * a sequence rather than places somebody moves between freely.
 *
 * Every tab but Projects is drawn only for somebody who may open it, asked of
 * the session rather than worked out from their role — a permission group can
 * hand out `audit.view` to somebody who is not an owner, and a shell reading
 * the role would hide the tab from them anyway.
 *
 * Hiding is not the security. The queries behind each screen refuse anybody
 * else. It is that a door somebody cannot open is one they will keep trying.
 */
function Tab({ to, name, icon, isActive }: TabProps): React.JSX.Element {
  // Capitalised locally because JSX reads a lowercase tag as an HTML element;
  // the property itself is `icon`, like every other property in the codebase.
  const Mark = icon;

  return (
    <Link
      to={to}
      className={styles.tab}
      aria-current={isActive ? 'page' : undefined}
      aria-label={name}
      title={name}
    >
      <span className={styles.tabMark}>
        <Mark />
      </span>
      {isActive && <span className={styles.tabName}>{name}</span>}
    </Link>
  );
}
