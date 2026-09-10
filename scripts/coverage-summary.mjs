import { readFileSync } from 'node:fs';

/**
 * Prints per-package coverage as a Markdown table.
 *
 * Vitest reports per file and one repository-wide total. Neither answers the
 * question a reviewer actually has — "is any package slipping?" — because a
 * single average lets a well-tested package hide a poorly-tested one. CI pipes
 * this into the run summary so the answer is on the pull request.
 */

const SUMMARY_PATH = '.output/coverage/coverage-summary.json';
const WINDOWS_SEPARATOR = String.fromCharCode(92);

/** Mirrors the floors in vitest.config.ts. app/Client is covered by Playwright. */
const LINE_FLOOR = 90;
const BRANCH_FLOOR = 85;
const PACKAGES_WITHOUT_A_FLOOR = new Set(['app/Client']);

const METRICS = /** @type {const} */ (['lines', 'functions', 'branches']);

/**
 * @typedef {{ covered: number, total: number }} MetricTotals
 * @typedef {Record<'lines' | 'functions' | 'branches', MetricTotals>} FileCoverage
 * @typedef {Record<'lines' | 'functions' | 'branches', [covered: number, total: number]} PackageTotals
 */

/**
 * @returns {Record<string, FileCoverage>}
 */
function readSummary() {
  try {
    // Landing the parse in `unknown` first, then asserting the shape, keeps
    // the `any` JSON.parse returns from spreading through the rest of the file.
    /** @type {unknown} */
    const parsed = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'));
    return /** @type {Record<string, FileCoverage>} */ (parsed);
  } catch {
    process.stdout.write(`No coverage summary at ${SUMMARY_PATH}. Run \`pnpm test:coverage\`.\n`);
    process.exit(0);
  }
}

/**
 * @param {string} filePath
 * @returns {string | undefined}
 */
function packageNameFor(filePath) {
  const normalised = filePath.split(WINDOWS_SEPARATOR).join('/');
  return /(app\/[^/]+)\//.exec(normalised)?.[1];
}

/**
 * @param {Record<string, FileCoverage>} summary
 * @returns {Map<string, PackageTotals>}
 */
function groupByPackage(summary) {
  /** @type {Map<string, PackageTotals>} */
  const packages = new Map();

  for (const [filePath, metrics] of Object.entries(summary)) {
    const name = filePath === 'total' ? undefined : packageNameFor(filePath);

    if (name === undefined) {
      continue;
    }

    const totals = packages.get(name) ?? {
      lines: /** @type {[number, number]} */ ([0, 0]),
      functions: /** @type {[number, number]} */ ([0, 0]),
      branches: /** @type {[number, number]} */ ([0, 0]),
    };

    for (const metric of METRICS) {
      totals[metric][0] += metrics[metric].covered;
      totals[metric][1] += metrics[metric].total;
    }

    packages.set(name, totals);
  }

  return packages;
}

/**
 * @param {[number, number]} counts
 * @returns {number | null} null when the package has nothing to measure.
 */
const percentageOf = ([covered, total]) => (total === 0 ? null : (covered / total) * 100);

/** @param {number | null} value */
const format = (value) => (value === null ? '—' : `${value.toFixed(1)}%`);

/**
 * @param {string} name
 * @param {PackageTotals} totals
 */
function verdictFor(name, totals) {
  if (PACKAGES_WITHOUT_A_FLOOR.has(name)) {
    return 'Playwright';
  }

  const lines = percentageOf(totals.lines);
  const branches = percentageOf(totals.branches);
  const meetsFloor =
    (lines === null || lines >= LINE_FLOOR) && (branches === null || branches >= BRANCH_FLOOR);

  return meetsFloor ? 'pass' : 'BELOW FLOOR';
}

const packages = groupByPackage(readSummary());

process.stdout.write('## Coverage\n\n');
process.stdout.write('| Package | Lines | Functions | Branches | |\n');
process.stdout.write('| --- | ---: | ---: | ---: | --- |\n');

for (const name of [...packages.keys()].sort()) {
  const totals = /** @type {PackageTotals} */ (packages.get(name));
  const cells = [
    name,
    format(percentageOf(totals.lines)),
    format(percentageOf(totals.functions)),
    format(percentageOf(totals.branches)),
    verdictFor(name, totals),
  ];

  process.stdout.write(`| ${cells.join(' | ')} |\n`);
}

process.stdout.write(
  `\nFloors: ${String(LINE_FLOOR)}% lines, ${String(BRANCH_FLOOR)}% branches, enforced per package by Vitest. ` +
    '`app/Client` is covered end to end by Playwright instead.\n',
);
