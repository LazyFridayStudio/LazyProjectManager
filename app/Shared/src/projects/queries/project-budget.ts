import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { projectSlugSchema } from '../project-vocabulary.js';

/**
 * One heading of the budget: a category, what was set aside for it, and what
 * the things filed under it are estimated to cost.
 *
 * `budgetMinor` is null when nobody has budgeted it, which is not the same as
 * budgeting nothing — a category with no figure is one nobody has decided
 * about, and a zero would report it as decided and blown.
 */
export const budgetCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: z.string(),
  assetCount: z.number().int(),
  estimatedMinor: z.number().int(),
  /** The approved and final part, which will not now go down. */
  committedMinor: z.number().int(),
  budgetMinor: z.number().int().nullable(),
  /** Assets here with no cost on them at all, which is what a total is missing. */
  unestimatedCount: z.number().int(),
});

/**
 * The whole project, added up.
 *
 * Every figure here is the sum of the categories below it, so the headline and
 * the table can never disagree — every asset belongs to exactly one category,
 * which is what makes that safe.
 */
export const budgetTotalsSchema = z.object({
  /** What the studio set aside for the project. Null until somebody decides. */
  budgetMinor: z.number().int().nullable(),
  /** What the categories have between them, which need not match the project's. */
  allocatedMinor: z.number().int(),
  estimatedMinor: z.number().int(),
  committedMinor: z.number().int(),
  assetCount: z.number().int(),
  unestimatedCount: z.number().int(),
});

export const projectBudgetViewSchema = z.object({
  project: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    code: z.string(),
    currency: z.string(),
  }),
  totals: budgetTotalsSchema,
  categories: z.array(budgetCategorySchema),
});

export type ProjectBudgetView = z.infer<typeof projectBudgetViewSchema>;
export type BudgetCategory = z.infer<typeof budgetCategorySchema>;

/**
 * What the project is going to cost, by the headings a studio files work under.
 *
 * Estimates rather than spend: this product has no invoices in it, and calling
 * an estimate spend would be a number somebody takes to a meeting. What it can
 * say honestly is what has been committed — an approved asset is a figure that
 * will not now go down — and how much of the total nobody has estimated at all,
 * which is the part a budget is usually wrong by.
 */
export const projectBudgetQuery = defineQuery(
  'projects.budget',
  z.object({ slug: projectSlugSchema }),
  projectBudgetViewSchema,
);
