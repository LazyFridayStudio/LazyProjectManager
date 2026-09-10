import {
  describeAssetStatus,
  describeCardType,
  ASSET_STATUSES,
  CARD_TYPES,
  type MilestonePlanView,
  type Milestone,
  type ProjectDashboardView,
  type ProjectSection,
} from '@lpm/shared';

import { describeFailure, isNotPermitted } from '../../api/failure-messages.js';
import { ScreenHeader } from '../shell/ScreenHeader.js';
import { ReleasePlan } from '../milestones/ReleasePlan.js';
import { useMilestonePlan } from '../../logic/milestones/use-milestones.js';
import { formatMoney } from '../../logic/projects/format-project-values.js';
import { LoadingProject } from '../shell/LoadingProject.js';
import { ProjectShell } from '../shell/ProjectShell.js';
import { useDashboard } from '../../logic/dashboard/use-dashboard.js';
import { useWorkspace } from '../../logic/shell/use-workspace.js';
import styles from './DashboardScreen.module.css';

/**
 * The state of a project, on one screen.
 *
 * Everything here is counted from the board and the library rather than entered
 * anywhere: a dashboard somebody has to keep up to date is a dashboard that is
 * wrong by Wednesday.
 */
export function DashboardScreen({ slug }: { slug: string }): React.JSX.Element {
  const dashboard = useDashboard(slug);
  // A second query rather than more of the first: the release plan is its own
  // thing with its own screen, and a milestone rollup written twice is two
  // rollups that disagree.
  const plan = useMilestonePlan(slug);

  if (dashboard.isPending || plan.isPending) {
    return <LoadingProject slug={slug} active="dashboard" />;
  }

  /*
   * The plan is a second query behind a second permission, and being refused it
   * is not a reason to refuse the dashboard.
   *
   * A group that allowed `dashboard.view` and denied `milestone.view` used to
   * leave this screen showing nothing but a refusal — and a refusal naming a
   * permission the person was never trying to use. They were granted the
   * dashboard; the dashboard told them they were not allowed something else.
   *
   * So a refusal loses the release plan and keeps the rest, and anything that
   * is not a refusal still takes the screen. The figures, the pipeline and the
   * budget are all `dashboard.view`, and all of them were granted.
   */
  const refused = plan.isError && isNotPermitted(plan.error);

  if (dashboard.isError || (plan.isError && !refused)) {
    return (
      <p className={styles.problem} role="alert">
        {describeFailure(dashboard.error ?? plan.error ?? new Error('Unknown'))}
      </p>
    );
  }

  return (
    <Dashboard
      view={dashboard.data}
      plan={plan.data ?? null}
      refusal={refused ? describeFailure(plan.error) : null}
      slug={slug}
    />
  );
}

function Dashboard({
  view,
  plan,
  refusal,
  slug,
}: {
  view: ProjectDashboardView;
  /** Null when this person may not see it, which is what `refusal` says. */
  plan: MilestonePlanView | null;
  refusal: string | null;
  slug: string;
}): React.JSX.Element {
  const { work, pipeline, budget, project } = view;
  const active = plan?.milestones.find((milestone) => milestone.state === 'active') ?? null;
  /*
   * A block belongs to a section, and leaves when that section does.
   *
   * With Budget switched off, a burn chart of nothing is furniture on the one
   * screen a project opens to. Undefined while the sidebar is still loading, so
   * the blocks draw rather than flickering out and back in.
   */
  const workspace = useWorkspace(slug);
  const draws = (section: ProjectSection): boolean =>
    workspace.data?.sections.includes(section) ?? true;

  return (
    <ProjectShell project={project} active="dashboard">
      <div className={styles.screen}>
        <ScreenHeader
          title="Production overview"
          facts={
            <>
              <span>{project.name}</span>
              <span>{project.code}</span>
              <span>{describeDates(project)}</span>
            </>
          }
        />

        <div className={styles.body}>
          <div className={styles.figures}>
            <Figure
              label="Open work"
              value={String(work.openCount)}
              note={`${String(work.closedCount)} closed`}
            />
            <Figure
              label="Blocked"
              value={String(work.blockedCount)}
              note={work.blockedCount === 0 ? 'nothing is stuck' : 'waiting on something'}
              alarming={work.blockedCount > 0}
            />
            <Figure
              label="Overdue"
              value={String(work.overdueCount)}
              note={`${String(work.dueSoonCount)} due this week`}
              alarming={work.overdueCount > 0}
            />
            <Figure
              label="Assets tracked"
              value={String(pipeline.total)}
              note={`${String(pipeline.byStatus.approved + pipeline.byStatus.final)} approved`}
            />
          </div>

          {plan === null ? (
            /* Said rather than left as a gap: a screen missing a panel with
               nothing where it was reads as broken.
               
               A sentence first and the server's words after it. `Not permitted
               to milestone.view.` is exact and is the thing to quote at whoever
               grants it — and on its own it is an action name at somebody who
               was reading a dashboard. */
            <div className={styles.notPermitted} role="status">
              <p className={styles.notPermittedSaid}>
                The release plan is not yours to see. The rest of this screen is.
              </p>
              {refusal !== null && <p className={styles.notPermittedWhy}>{refusal}</p>}
            </div>
          ) : (
            <ReleasePlan plan={plan} canWrite={!project.archived} />
          )}

          {/* The three summaries sit side by side, as the design has them. They
              are three readings of the same week, and reading across is the whole
              point of putting them on one screen. */}
          <div className={styles.blocks}>
            {draws('assets') && (
              <Block title="Asset pipeline" meta={`${String(pipeline.total)} tracked`}>
                <Pipeline pipeline={pipeline} />
              </Block>
            )}

            {draws('budget') && (
              <Block title="Budget burn" meta={project.currency}>
                <Spend budget={budget} currency={project.currency} />
              </Block>
            )}

            {draws('timeline') && (
              <Block
                title="Milestone burndown"
                meta={active === null ? undefined : describeDaysLeft(active)}
              >
                <Burndown work={work} active={active} slug={slug} />
              </Block>
            )}
          </div>
        </div>
      </div>
    </ProjectShell>
  );
}

/**
 * How far along the things being made are.
 *
 * A bar per stage rather than a number per stage: the shape of the pipeline is
 * the message, and a project with everything in concept and a project with
 * everything in review are in very different trouble.
 */
function Pipeline({ pipeline }: { pipeline: ProjectDashboardView['pipeline'] }): React.JSX.Element {
  if (pipeline.total === 0) {
    return (
      <p className={styles.empty}>
        Nothing in the library yet. An asset is a thing the game needs.
      </p>
    );
  }

  return (
    <>
      {/* Every stage, including the empty ones: a pipeline drawn from only what
          is populated changes shape as it fills, and the gaps are half of what
          the shape says. */}
      <div className={styles.stages}>
        {ASSET_STATUSES.map((status) => (
          <div key={status} className={styles.stage}>
            <span className={styles.stageName}>{describeAssetStatus(status)}</span>
            <Bar share={pipeline.byStatus[status] / pipeline.total} status={status} />
            <span className={styles.stageCount}>{String(pipeline.byStatus[status])}</span>
          </div>
        ))}
      </div>

      <div className={styles.notes}>
        <span>Awaiting review: {String(pipeline.byStatus.review)}</span>
        <span data-alarming={pipeline.overdueCount > 0}>
          Overdue: {String(pipeline.overdueCount)}
        </span>
        {/* Usually the real bottleneck, and never visible from a board that
            only shows what is being worked on. */}
        <span>Unassigned: {String(pipeline.unassignedCount)}</span>
      </div>
    </>
  );
}

/**
 * What the project is estimated to cost, against what was set aside.
 *
 * Over budget is shown rather than refused: the estimate is what it is, and
 * somebody has to see it to do anything about it.
 */
function Spend({
  budget,
  currency,
}: {
  budget: ProjectDashboardView['budget'];
  currency: string;
}): React.JSX.Element {
  // An approved estimate is a commitment: it will not now go down. The rest of
  // the estimate still could, which is why the two are separate rows.
  const open = budget.estimatedMinor - budget.committedMinor;

  if (budget.budgetMinor === null) {
    return (
      <>
        <Headline
          value={formatMoney(budget.estimatedMinor, currency)}
          note="estimated"
          empty="No budget set. A studio that has not decided yet is a normal state, not a zero."
        />
        <ul className={styles.rows}>
          <Row label="Committed" value={formatMoney(budget.committedMinor, currency)} tint="firm" />
          <Row label="Open commitments" value={formatMoney(open, currency)} tint="soft" />
        </ul>
      </>
    );
  }

  const share = budget.budgetMinor === 0 ? 1 : budget.estimatedMinor / budget.budgetMinor;
  const left = budget.budgetMinor - budget.estimatedMinor;

  return (
    <>
      <Headline
        value={formatMoney(budget.estimatedMinor, currency)}
        note={`of ${formatMoney(budget.budgetMinor, currency)}`}
      />
      <Bar share={share} over={share > 1} />
      <ul className={styles.rows}>
        <Row label="Committed" value={formatMoney(budget.committedMinor, currency)} tint="firm" />
        <Row label="Open commitments" value={formatMoney(open, currency)} tint="soft" />
        <Row label="Left" value={formatMoney(left, currency)} tint="spare" alarming={left < 0} />
      </ul>
    </>
  );
}

/**
 * How the work is going, in the unit anybody here estimates in.
 *
 * Points rather than cards, because a card is not a size: ten cards closed can
 * be a week or an afternoon.
 */
function Burndown({
  work,
  active,
  slug,
}: {
  work: ProjectDashboardView['work'];
  /** The running milestone, when there is one. Its points are the ones that matter. */
  active: Milestone | null;
  slug: string;
}): React.JSX.Element {
  // A burndown of the whole project is a number that only ever goes up as the
  // backlog grows. Scoped to the milestone that is running, it is the question
  // somebody actually has: does this land.
  const workspace = useWorkspace(slug);
  const canOpenTheBoard = workspace.data?.sections.includes('board') ?? true;
  const closed = active?.pointsClosed ?? work.pointsClosed;
  const total = active?.pointsTotal ?? work.pointsTotal;

  return (
    <>
      {total === 0 ? (
        <Headline
          value="—"
          note="no points yet"
          empty={
            active === null
              ? 'Nothing is estimated yet. Points on a card are what this counts.'
              : `Nothing on ${active.name} is estimated yet. Points on a card are what this counts.`
          }
        />
      ) : (
        <>
          <Headline
            value={`${String(Math.round((closed / total) * 100))}%`}
            note={`of ${String(total)} points closed${active === null ? '' : ` on ${active.name}`}`}
          />
          <Bar share={closed / total} />
        </>
      )}

      <ul className={styles.rows}>
        {CARD_TYPES.map((type) => (
          <Row
            key={type}
            label={describeCardType(type)}
            value={`${String(work.openByType[type])} open`}
          />
        ))}
      </ul>

      {/* A number with no way to the thing it counts is a number somebody has
          to go and find by hand — unless the way leads somewhere they cannot
          go. The sidebar asks the same question, and a link the nav has just
          stopped drawing would be the same dead door in a second place. */}
      {canOpenTheBoard && (
        <a className={styles.onward} href={`/p/${slug}/tasks`}>
          Open task board →
        </a>
      )}
    </>
  );
}

function Headline({
  value,
  note,
  empty,
}: {
  value: string;
  note: string;
  empty?: string;
}): React.JSX.Element {
  return (
    <>
      <div className={styles.headline}>
        <span className={styles.headlineValue}>{value}</span>
        <span className={styles.headlineNote}>{note}</span>
      </div>
      {empty !== undefined && <p className={styles.empty}>{empty}</p>}
    </>
  );
}

function Figure({
  label,
  value,
  note,
  alarming = false,
}: {
  label: string;
  value: string;
  note: string;
  alarming?: boolean;
}): React.JSX.Element {
  return (
    <div className={styles.figure}>
      <span className={styles.figureLabel}>{label}</span>
      <span className={styles.figureValue} data-alarming={alarming}>
        {value}
      </span>
      <span className={styles.figureNote}>{note}</span>
    </div>
  );
}

/** A labelled row with its number held to the right, so a column reads down. */
function Row({
  label,
  value,
  tint,
  alarming = false,
}: {
  label: string;
  value: string;
  tint?: 'firm' | 'soft' | 'spare';
  alarming?: boolean;
}): React.JSX.Element {
  return (
    <li className={styles.row}>
      {tint !== undefined && <span className={styles.swatch} data-tint={tint} aria-hidden />}
      <span>{label}</span>
      <span className={styles.rowValue} data-alarming={alarming}>
        {value}
      </span>
    </li>
  );
}

/**
 * A block, and what its numbers are measured in.
 *
 * The unit goes in the header rather than beside every figure, which is how the
 * design keeps a narrow column readable.
 */
function Block({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className={styles.block} aria-label={title}>
      <div className={styles.blockHead}>
        <h2 className={styles.blockTitle}>{title}</h2>
        {meta !== undefined && <span className={styles.blockMeta}>{meta}</span>}
      </div>
      {children}
    </section>
  );
}

function Bar({
  share,
  over = false,
  status,
}: {
  share: number;
  over?: boolean;
  status?: string;
}): React.JSX.Element {
  return (
    <span className={styles.bar}>
      <span
        className={styles.barFill}
        style={{ width: `${String(Math.min(100, Math.round(share * 100)))}%` }}
        data-over={over}
        data-status={status}
      />
    </span>
  );
}

/** `3 days left`, or `9 days over` once the date has gone by. */
function describeDaysLeft(milestone: Milestone): string {
  return milestone.daysLeft < 0
    ? `${String(-milestone.daysLeft)} days over`
    : `${String(milestone.daysLeft)} days left`;
}

/** When the project runs, or that nobody has decided yet. */
function describeDates(project: ProjectDashboardView['project']): string {
  if (project.datesTbd || (project.startsOn === null && project.shipsOn === null)) {
    return 'dates not set';
  }

  return `${project.startsOn ?? '…'} → ${project.shipsOn ?? '…'}`;
}
