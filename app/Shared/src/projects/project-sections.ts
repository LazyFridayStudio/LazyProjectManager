import { z } from 'zod';

/**
 * The screens a project has, named once so both sides can say the same words.
 *
 * The sidebar draws them and the server decides which of them this person may
 * open, so the names have to be shared: a client filtering on `'tasks'` against
 * a server answering `'board'` would quietly draw an empty sidebar, and nothing
 * would say so.
 *
 * In the order they are drawn.
 */
export const projectSectionSchema = z.enum([
  'dashboard',
  'assets',
  'board',
  'timeline',
  'builds',
  'budget',
  'docs',
  'settings',
]);

/** Which screen of a project is open, and which ones can be. */
export type ProjectSection = z.infer<typeof projectSectionSchema>;

/**
 * The sections a project can turn off, and the two it cannot.
 *
 * **Dashboard and Settings stay, for different reasons.** The dashboard is the
 * project's front page and `/p/$slug` is where the launcher sends people, so a
 * project without one is a project you arrive at nowhere. Settings stays for a
 * plainer reason: turning it off would take the switch that turns it back on
 * with it, and the project would be stuck that way until somebody edited the
 * database.
 *
 * Order follows the sidebar, so the switches read in the order the doors do.
 */
export const SWITCHABLE_PROJECT_SECTIONS = [
  'assets',
  'board',
  'timeline',
  'builds',
  'budget',
  'docs',
] as const satisfies readonly ProjectSection[];

/** A section somebody can switch off, which is not every section. */
export type SwitchableProjectSection = (typeof SWITCHABLE_PROJECT_SECTIONS)[number];

export const switchableProjectSectionSchema = z.enum(SWITCHABLE_PROJECT_SECTIONS);

/**
 * Whether a project draws this section at all.
 *
 * A preference, not a permission: it says what the project does rather than
 * what this person may see. The sidebar needs both, and `project-workspace`
 * is where the two are put together.
 */
export function projectUsesSection(
  section: ProjectSection,
  disabled: readonly ProjectSection[],
): boolean {
  return !disabled.includes(section);
}

/**
 * What a section is called where somebody reads it.
 *
 * Beside the names rather than in the sidebar that draws them, because the
 * settings screen lists the same six and two of the words are not the name:
 * `board` is **Tasks** and `docs` is **Design doc**. Two lists of labels would
 * agree today and disagree the first time one of them was renamed, which is a
 * switch that says Tasks turning off a door that says something else.
 */
const LABEL_BY_SECTION: Readonly<Record<ProjectSection, string>> = {
  dashboard: 'Dashboard',
  assets: 'Assets',
  board: 'Tasks',
  timeline: 'Timeline',
  builds: 'Builds',
  budget: 'Budget',
  docs: 'Design doc',
  settings: 'Settings',
};

export function describeProjectSection(section: ProjectSection): string {
  return LABEL_BY_SECTION[section];
}
