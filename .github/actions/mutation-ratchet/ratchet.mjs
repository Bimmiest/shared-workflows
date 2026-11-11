#!/usr/bin/env node
/**
 * Whether a mutation floor holds, in both directions (#37).
 *
 *   node ratchet.mjs [--report reports/mutation/mutation.json] [--config stryker.config.mjs] [--slack 1]
 *   node ratchet.mjs --shards <dir> [--prefix mutation-report] [--config …] [--slack 1] [--summary file]
 *
 * Stryker fails a run under `thresholds.break`. Nothing fails a run that is
 * well above it, so the floor holds in one direction only, and the gap is the
 * room that a later regression hides in. This is the other direction, as
 * `coverage-ratchet` is for coverage: it reads the JSON report, computes the
 * score from the status of each mutant, and fails when the score is more
 * than `slack` points above the floor, with the floor to write. It also fails
 * under the floor, so that it can hold a run in which Stryker had no floor.
 *
 * One point of slack by default, as repo-template ADR 0004 decided for the
 * coverage ratchet: a floor is the score rounded down to a whole number, so
 * a floor of 86 under a score of 86.9 is as tight as a whole number gets.
 *
 * With --shards, it reads the report of each shard of the full run of
 * `mutation.yml`, from `<dir>/<prefix>-<shard>-of-<count>/mutation.json`, and
 * scores their files together. Each shard ran with MUTATION_SHARD=1 and no
 * floor, because one shard alone can be under the floor while the run is not.
 * It fails when a shard is missing or a file is in two reports.
 */
import { appendFileSync, existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { mergeFiles, readBreak, score, shardCount } from './stryker.mjs';

/** How far above its floor a score may be before the floor must move. */
export const DEFAULT_SLACK = 1;

const pct = (n) => `${n.toFixed(2)}%`;

/**
 * The lines to print and the exit code, for the score `measured` against
 * the floor `floor` of the config `config`.
 */
export function verdict(measured, floor, { slack = DEFAULT_SLACK, config = 'stryker.config.mjs' } = {}) {
  const { killed, total, score: value } = measured;
  if (floor === null) {
    return { lines: [`::error file=${config}::thresholds.break in ${config} is null, so there is no floor to hold. Set it to a number.`], code: 1 };
  }
  if (value === null) {
    return { lines: ['::error::No mutant in the report counts for the score: each one is ignored, or did not compile or run. Check that Stryker mutated the files.'], code: 1 };
  }
  const counts = `${killed} of ${total} mutants detected`;
  if (value < floor) {
    return { lines: [`::error file=${config}::The mutation score is ${pct(value)} (${counts}), under its floor of ${floor}% in ${config}. Add tests that kill the mutants that survived.`], code: 1 };
  }
  if (value - floor > slack) {
    const raise = Math.floor(value);
    return {
      lines: [
        `::error file=${config}::The mutation score is ${pct(value)} (${counts}), more than ${slack} point(s) above its floor of ${floor}% in ${config}. Raise thresholds.break to ${raise}.`,
        '',
        `Write this in ${config}, and update the date and the score in the comment beside it:`,
        '',
        `  thresholds: { …, break: ${raise} },`,
      ],
      code: 1,
    };
  }
  return { lines: [`The mutation score is ${pct(value)} (${counts}), within ${slack} point(s) above its floor of ${floor}% in ${config}.`], code: 0 };
}

/**
 * The files of the shard reports in `dir`, merged, and a Markdown table of
 * the score of each shard and of all of them. Throws an Error that says what
 * is wrong with the set of reports.
 */
export function readShards(dir, prefix = 'mutation-report') {
  if (!existsSync(dir)) throw new Error(`There is no directory ${dir}. Download the shard reports into it first.`);
  const names = readdirSync(dir).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const count = shardCount(names, prefix);
  const reports = names.map((name) => {
    const file = path.join(dir, name, 'mutation.json');
    if (!existsSync(file)) throw new Error(`${name} has no mutation.json. Upload the directory that holds the json reporter's file.`);
    return JSON.parse(readFileSync(file, 'utf8'));
  });
  const files = mergeFiles(reports);
  const row = (label, fileCount, s) => `| ${label} | ${fileCount} | ${s.killed} | ${s.total} | ${s.score === null ? 'n/a' : pct(s.score)} |`;
  const table = [
    '| Shard | Files | Detected | Counted | Score |',
    '|---|---|---|---|---|',
    ...reports.map((report, i) => row(`${i + 1} of ${count}`, Object.keys(report.files ?? {}).length, score(report.files))),
    row('All', Object.keys(files).length, score(files)),
  ];
  return { files, table };
}

/** Runs the check with the command-line `argv`. Returns the exit code. */
export function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      report: { type: 'string', default: 'reports/mutation/mutation.json' },
      config: { type: 'string', default: 'stryker.config.mjs' },
      slack: { type: 'string', default: String(DEFAULT_SLACK) },
      shards: { type: 'string' },
      prefix: { type: 'string', default: 'mutation-report' },
      summary: { type: 'string' },
    },
  });
  const slack = Number(values.slack);
  if (values.slack.trim() === '' || !Number.isFinite(slack) || slack < 0) {
    console.log(`::error::slack is "${values.slack}". Set it to a number, 0 or more.`);
    return 1;
  }
  if (!existsSync(values.config)) {
    console.log(`::error::No Stryker config at ${values.config}. Give its path with config.`);
    return 1;
  }
  let floor;
  try {
    ({ floor } = readBreak(readFileSync(values.config, 'utf8'), values.config));
  } catch (error) {
    console.log(`::error file=${values.config}::${error.message}.`);
    return 1;
  }
  let files;
  if (values.shards !== undefined) {
    let table;
    try {
      ({ files, table } = readShards(values.shards, values.prefix));
    } catch (error) {
      console.log(`::error::${error.message}`);
      return 1;
    }
    const text = `${table.join('\n')}\n\n`;
    if (values.summary) appendFileSync(values.summary, text);
    else process.stdout.write(text);
  } else {
    if (!existsSync(values.report)) {
      // Stryker writes the report with the json reporter only. A run that
      // stopped before the end writes none.
      console.log(`::error::No mutation report at ${values.report}. Add 'json' to the reporters of ${values.config}, and run Stryker to the end first.`);
      return 1;
    }
    files = JSON.parse(readFileSync(values.report, 'utf8')).files;
  }
  const { lines, code } = verdict(score(files), floor, { slack, config: values.config });
  for (const line of lines) console.log(line);
  return code;
}

// Importing this file (the test does) must not read the working directory.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href) {
  process.exitCode = main(process.argv.slice(2));
}
