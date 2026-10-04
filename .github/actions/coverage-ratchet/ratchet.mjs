#!/usr/bin/env node
/**
 * Whether a coverage floor has fallen behind what the suite measures.
 *
 *   node ratchet.mjs [--config vitest.config.ts] [--summary coverage/coverage-summary.json] [--slack 1]
 *
 * vitest's `coverage.thresholds` already fail a run that falls *below* a
 * floor. Nothing fails one that has risen well above it, so the ratchet only
 * turned when somebody remembered to turn it, and the gap between what is
 * measured and what is enforced is exactly the room a later regression hides
 * in (propslab #506, propslab-ent #1592). This is the other pawl: after
 * `vitest run --coverage` with the `json-summary` reporter, it reads the
 * summary and fails when any floor sits more than `slack` points under its
 * measurement, printing the numbers to write.
 *
 * One point of slack by default, because a floor is the measured value
 * rounded down to a whole percent: a floor of 86 over a measured 86.9 is as
 * tight as a whole number gets, and failing it would ask for a raise that
 * cannot be written.
 *
 * The config is imported, so the floors checked are exactly the ones vitest
 * enforces, per-glob thresholds included. Node strips the types itself, which
 * holds as long as the config is erasable TypeScript. When the import fails
 * (a plugin that will not load outside the test runner, say) the top-level
 * `thresholds: { … }` block is read as text instead, and the run says so.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

/** The four metrics v8 reports, and vitest's names for their thresholds. */
export const METRICS = ['statements', 'branches', 'functions', 'lines'];

/** How far above its floor a metric may measure before the floor must move. */
export const DEFAULT_SLACK = 1;

/**
 * Measured percentage per metric over the summary entries `keep` selects,
 * from covered/total counts the way vitest computes a glob threshold. `null`
 * when nothing was selected.
 */
export function measure(summary, keep = () => true) {
  const sums = Object.fromEntries(METRICS.map((m) => [m, { covered: 0, total: 0 }]));
  for (const [file, entry] of Object.entries(summary)) {
    if (file === 'total' || !keep(file)) continue;
    for (const m of METRICS) {
      sums[m].covered += entry[m]?.covered ?? 0;
      sums[m].total += entry[m]?.total ?? 0;
    }
  }
  return Object.fromEntries(
    METRICS.map((m) => [m, sums[m].total === 0 ? null : (100 * sums[m].covered) / sums[m].total]),
  );
}

/**
 * The `thresholds` object from a vitest config module: its default export, or
 * what the default export returns when `defineConfig` was given a function.
 */
export async function thresholdsFromConfig(configPath) {
  const loaded = (await import(pathToFileURL(path.resolve(configPath)).href)).default;
  const config = typeof loaded === 'function' ? await loaded({ mode: 'test', command: 'serve' }) : loaded;
  const thresholds = config?.test?.coverage?.thresholds;
  if (!thresholds || typeof thresholds !== 'object') {
    throw new Error(`${configPath} declares no test.coverage.thresholds.`);
  }
  return thresholds;
}

/**
 * The fallback: the top-level numbers in the first `thresholds: { … }` block,
 * read as text. Per-glob thresholds are nested objects and are not read here.
 */
export function thresholdsFromText(source) {
  const block = /thresholds:\s*\{([^}]*)\}/.exec(source);
  if (!block) throw new Error('No `thresholds: { … }` block in the config.');
  const thresholds = {};
  for (const [, key, value] of block[1].matchAll(/(\w+):\s*(\d+(?:\.\d+)?)/g)) {
    thresholds[key] = Number(value);
  }
  return thresholds;
}

/**
 * Every floor that is above its measurement, more than `slack` under it, or
 * over a glob nothing matches. `root` is the directory the config's globs are
 * relative to; summary keys are absolute paths.
 */
export function problems(thresholds, summary, { slack = DEFAULT_SLACK, root = process.cwd() } = {}) {
  const found = [];
  const check = (scope, floors, actual) => {
    for (const m of METRICS) {
      const floor = floors[m];
      if (typeof floor !== 'number') continue;
      const now = actual[m];
      if (now === null) found.push({ scope, metric: m, kind: 'empty', floor, measured: null, raise: null });
      else if (now < floor) found.push({ scope, metric: m, kind: 'under', floor, measured: now, raise: null });
      else if (now - floor > slack) found.push({ scope, metric: m, kind: 'stale', floor, measured: now, raise: Math.floor(now) });
    }
  };
  const rel = (file) => path.relative(root, file).split(path.sep).join('/');
  check('global', thresholds, measure(summary));
  for (const [glob, floors] of Object.entries(thresholds)) {
    if (typeof floors !== 'object' || floors === null) continue;
    check(glob, floors, measure(summary, (file) => path.matchesGlob(rel(file), glob)));
  }
  return found;
}

const pct = (n) => (n === null ? '   n/a' : `${n.toFixed(2)}%`.padStart(7));

/** The lines to print and the exit code. */
export function report(thresholds, summary, options = {}) {
  const found = problems(thresholds, summary, options);
  const global = measure(summary);
  const table = METRICS.filter((m) => typeof thresholds[m] === 'number').map(
    (m) => `  ${m.padEnd(10)} measured ${pct(global[m])}  floor ${thresholds[m]}%`,
  );
  if (found.length === 0) {
    return { lines: [`Every coverage floor is within ${options.slack ?? DEFAULT_SLACK} point(s) of its measurement:`, ...table], code: 0 };
  }
  const lines = found.map(({ scope, metric, kind, floor, measured, raise }) => {
    const where = scope === 'global' ? metric : `${scope} ${metric}`;
    if (kind === 'empty') return `::error::Coverage floor for ${where} is ${floor}%, but no file matches, so nothing is measured.`;
    if (kind === 'under') return `::error::Coverage for ${where} measured ${measured.toFixed(2)}%, under its floor of ${floor}%.`;
    return `::error::Coverage for ${where} measured ${measured.toFixed(2)}%, more than ${options.slack ?? DEFAULT_SLACK} point(s) above its floor of ${floor}%. Raise it to ${raise}.`;
  });
  const next = Object.fromEntries(
    METRICS.filter((m) => typeof thresholds[m] === 'number').map((m) => [
      m,
      global[m] === null ? thresholds[m] : Math.max(thresholds[m], Math.floor(global[m])),
    ]),
  );
  return {
    lines: [
      ...lines,
      '',
      ...table,
      '',
      'Write these in the vitest config (coverage.thresholds), and update the "Measured on" line beside them:',
      '',
      '      thresholds: {',
      ...Object.entries(next).map(([m, v]) => `        ${m}: ${v},`),
      '      },',
    ],
    code: 1,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', default: 'vitest.config.ts' },
      summary: { type: 'string', default: 'coverage/coverage-summary.json' },
      slack: { type: 'string', default: String(DEFAULT_SLACK) },
      parse: { type: 'string', default: 'import' },
    },
  });
  if (!existsSync(values.summary)) {
    // vitest writes no report from a run with a failing test (`reportOnFailure`
    // is off by default), so a missing summary almost always means the suite
    // was red.
    console.log(`::error::No coverage summary at ${values.summary}. Run the suite with --coverage and the json-summary reporter first, and get it green.`);
    return 1;
  }
  const summary = JSON.parse(readFileSync(values.summary, 'utf8'));
  let thresholds;
  if (values.parse === 'text') {
    thresholds = thresholdsFromText(readFileSync(values.config, 'utf8'));
  } else {
    try {
      thresholds = await thresholdsFromConfig(values.config);
    } catch (error) {
      console.log(`::notice::Could not import ${values.config} (${error instanceof Error ? error.message.split('\n')[0] : String(error)}); reading its top-level thresholds as text instead.`);
      thresholds = thresholdsFromText(readFileSync(values.config, 'utf8'));
    }
  }
  const slack = Number(values.slack);
  if (!Number.isFinite(slack) || slack < 0) throw new Error(`--slack must be a non-negative number, not "${values.slack}".`);
  const { lines, code } = report(thresholds, summary, { slack, root: path.dirname(path.resolve(values.config)) });
  for (const line of lines) console.log(line);
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
