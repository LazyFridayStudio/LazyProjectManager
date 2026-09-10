import { Link } from '@tanstack/react-router';
import { ScreenHeader } from '../shell/ScreenHeader.js';
import type { BudgetCategory, ProjectBudgetView } from '@lpm/shared';

import { describeFailure } from '../../api/failure-messages.js';
import { formatMoney } from '../../logic/projects/format-project-values.js';
import { LoadingProject } from '../shell/LoadingProject.js';
import { ProjectShell } from '../shell/ProjectShell.js';
import { useBudget } from '../../logic/budget/use-budget.js';
import styles from './BudgetScreen.module.css';

/**
 * What the project is going to cost, by the headings a studio files work under.
 *
 * Estimates rather than spend: there are no invoices in this product, and
 * calling an estimate spend would be a number somebody takes to a meeting. What
 * it says instead is what is committed — an approved asset will not now go down
 * — and how much of the library nobody has costed at all, which is the part a
 * budget is usually wrong by.
 */
export function BudgetScreen({ slug }: { slug: string }): React.JSX.Element {
  const budget = useBudget(slug);

  if (budget.isPending) {
    return <LoadingProject slug={slug} active="budget" />;
  }

  if (budget.isError) {
    return (
      <p className={styles.problem} role="alert">
        {describeFailure(budget.error)}
      </p>
    );
  }

  return <Budget view={budget.data} slug={slug} />;
}

function Budget({ view, slug }: { view: ProjectBudgetView; slug: string }): React.JSX.Element {
  const { totals, project } = view;
  const currency = project.currency;
  const open = totals.estimatedMinor - totals.committedMinor;

  return (
    <ProjectShell project={project} active="budget">
      <div className={styles.screen}>
        <ScreenHeader
          title="Budget"
          facts={
            <>
              <span>estimate by category</span>
              <span>{currency}</span>
            </>
          }
          actions={
            <div className={styles.headline}>
              <span className={styles.headlineValue}>
                {formatMoney(totals.estimatedMinor, currency)}
              </span>
              <span className={styles.headlineNote}>
                {totals.budgetMinor === null
                  ? 'no budget set'
                  : `of ${formatMoney(totals.budgetMinor, currency)} · ${describeShare(totals.estimatedMinor, totals.budgetMinor)}`}
              </span>
            </div>
          }
        />

        <div className={styles.body}>
          <div className={styles.figures}>
            <Figure
              tone="firm"
              label="Committed"
              value={formatMoney(totals.committedMinor, currency)}
              note="approved and final, and will not go down"
            />
            <Figure
              tone="soft"
              label="Open commitments"
              value={formatMoney(open, currency)}
              note="estimated, still able to move"
            />
            <Figure
              tone="spare"
              label={totals.budgetMinor === null ? 'Allocated' : 'Left'}
              value={formatMoney(
                totals.budgetMinor === null
                  ? totals.allocatedMinor
                  : totals.budgetMinor - totals.estimatedMinor,
                currency,
              )}
              note={
                totals.budgetMinor === null
                  ? 'set aside across the categories'
                  : describeLeft(totals.budgetMinor - totals.estimatedMinor)
              }
              alarming={totals.budgetMinor !== null && totals.estimatedMinor > totals.budgetMinor}
            />
            <Figure
              tone="missing"
              label="Not estimated"
              value={String(totals.unestimatedCount)}
              /* The part the total is missing, rather than the part it is wrong by. */
              note={
                totals.unestimatedCount === 0
                  ? 'everything has a figure on it'
                  : `of ${String(totals.assetCount)} assets have no cost`
              }
              alarming={totals.unestimatedCount > 0}
            />
          </div>

          {view.categories.length === 0 ? (
            <p className={styles.empty}>
              Nothing in the library yet. A budget is read by category, so it needs the categories
              first.
            </p>
          ) : (
            <Table categories={view.categories} currency={currency} slug={slug} />
          )}
        </div>
      </div>
    </ProjectShell>
  );
}

function Table({
  categories,
  currency,
  slug,
}: {
  categories: readonly BudgetCategory[];
  currency: string;
  slug: string;
}): React.JSX.Element {
  return (
    <div className={styles.table} role="table" aria-label="Estimate by category">
      <div className={styles.headRow} role="row">
        <span role="columnheader">Category</span>
        <span role="columnheader">Items</span>
        <span role="columnheader">Estimate / budget</span>
        <span role="columnheader">Burn</span>
        <span className={styles.right} role="columnheader">
          %
        </span>
      </div>

      {categories.map((category) => (
        <Row key={category.id} category={category} currency={currency} slug={slug} />
      ))}
    </div>
  );
}

function Row({
  category,
  currency,
  slug,
}: {
  category: BudgetCategory;
  currency: string;
  slug: string;
}): React.JSX.Element {
  const over = category.budgetMinor !== null && category.estimatedMinor > category.budgetMinor;

  return (
    <Link
      to="/p/$slug/assets"
      params={{ slug }}
      hash={`category-${category.id}`}
      className={styles.row}
      role="row"
    >
      <span className={styles.name} role="cell">
        <span className={styles.swatch} style={{ background: category.color }} aria-hidden />
        {category.name}
      </span>

      <span className={styles.count} role="cell">
        {String(category.assetCount)}
        {category.unestimatedCount > 0 && (
          <span className={styles.missing}> · {String(category.unestimatedCount)} uncosted</span>
        )}
      </span>

      <span className={styles.money} role="cell">
        {formatMoney(category.estimatedMinor, currency)}
        {' / '}
        {/* An em dash rather than a zero: a category nobody has budgeted is not
            one budgeted at nothing, and a zero reports it as blown. */}
        {category.budgetMinor === null ? '—' : formatMoney(category.budgetMinor, currency)}
      </span>

      <span className={styles.burn} role="cell">
        <span className={styles.track}>
          <span
            className={styles.fill}
            style={{
              width: `${String(shareOf(category))}%`,
              background: over ? 'var(--color-danger)' : category.color,
            }}
          />
        </span>
      </span>

      <span className={styles.share} role="cell" data-over={over}>
        {category.budgetMinor === null
          ? '—'
          : describeShare(category.estimatedMinor, category.budgetMinor)}
      </span>
    </Link>
  );
}

function Figure({
  tone,
  label,
  value,
  note,
  alarming = false,
}: {
  tone: string;
  label: string;
  value: string;
  note: string;
  alarming?: boolean;
}): React.JSX.Element {
  return (
    <div className={styles.figure}>
      <span className={styles.figureLabel}>
        <span className={styles.figureSwatch} data-tone={tone} aria-hidden />
        {label}
      </span>
      <span className={styles.figureValue} data-alarming={alarming}>
        {value}
      </span>
      <span className={styles.figureNote}>{note}</span>
    </div>
  );
}

/**
 * How much of a budget an estimate takes, capped so a bar stays in its track.
 *
 * A category nobody has budgeted has an empty track rather than a full one:
 * there is nothing to have burnt through, and a full bar there reads as the
 * worst row on the screen when it is only the least decided.
 */
function shareOf(category: BudgetCategory): number {
  if (category.budgetMinor === null) return 0;

  // Budgeted at nothing is a decision, and anything against it is all of it.
  if (category.budgetMinor === 0) return category.estimatedMinor > 0 ? 100 : 0;

  return Math.min(100, Math.round((category.estimatedMinor / category.budgetMinor) * 100));
}

/** The real share, uncapped: a category at 140% should say so. */
function describeShare(estimated: number, budget: number): string {
  if (budget === 0) return estimated > 0 ? 'over' : '0%';

  return `${String(Math.round((estimated / budget) * 100))}%`;
}

function describeLeft(left: number): string {
  return left < 0 ? 'over the budget set' : 'of the budget unspoken for';
}
