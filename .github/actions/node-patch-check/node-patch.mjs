#!/usr/bin/env node
/**
 * Whether `.nvmrc` is the newest patch of its Node line (propslab #518).
 *
 *   node node-patch.mjs [--nvmrc .nvmrc] [--warn-only] [--eol-days N]
 *
 * `.nvmrc` is an exact version on purpose: CI, the build and local
 * development all run the toolchain that was tested. The cost is that
 * Dependabot has nothing to propose, since it does not read `.nvmrc`, so a
 * Node security release is picked up when someone happens to remember. This
 * asks nodejs.org for the newest release on the pinned major line and says
 * so when the pin is behind.
 *
 *   default      exit 1 when behind: the scheduled run, where a red run is
 *                the reminder
 *   --warn-only  print a ::warning:: and exit 0: pull requests, where an
 *                unrelated change should not fail on a Node release that
 *                shipped this morning
 *
 * It looks at the major line named and never at a newer major: moving to the
 * next LTS line is a decision (`engines`, the CI notes), not a patch. With
 * --eol-days N it also says when that line ends in fewer than N days, from
 * the release schedule, so that the move is filed as work before the security
 * releases stop (#74). N is 0, off, by default. An
 * index that cannot be reached is an error, not a pass, except under
 * --warn-only: a reminder that silently stops firing is the failure it
 * exists to prevent.
 */
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export const INDEX_URL = 'https://nodejs.org/dist/index.json';
// nodejs.org's index has no end-of-life dates; the Release working group's schedule does.
export const SCHEDULE_URL = 'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json';
const DAY_MS = 24 * 60 * 60 * 1000;

/** "v24.18.1" or "24.18.1" to [24, 18, 1]; null when it is not a plain x.y.z. */
export function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Negative, zero or positive, as Array.prototype.sort wants. */
export function compareVersions(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The newest release on `major`'s line in nodejs.org's index, or null. The index is not assumed sorted. */
export function latestOfMajor(index, major) {
  let latest = null;
  for (const entry of index) {
    const version = typeof entry?.version === 'string' ? parseVersion(entry.version) : null;
    if (version?.[0] !== major) continue;
    if (latest === null || compareVersions(version, latest) > 0) latest = version;
  }
  return latest;
}

/** The line to print and the exit code, for a pin against the newest release of its line. */
export function verdict(pinned, latest, { warnOnly = false, file = '.nvmrc' } = {}) {
  const pinnedText = pinned.join('.');
  if (!latest) return { line: `::error::nodejs.org lists no ${pinned[0]}.x release.`, code: 1 };
  const latestText = latest.join('.');
  if (compareVersions(pinned, latest) >= 0) return { line: `${file} (${pinnedText}) is the newest ${pinned[0]}.x release.`, code: 0 };
  const message =
    `${file} pins Node ${pinnedText} but ${latestText} is out. Bump ${file} to ${latestText} ` +
    '(setup-node reads it in every workflow) and read the release notes for security fixes: ' +
    `https://nodejs.org/en/blog/release/v${latestText}`;
  return warnOnly
    ? { line: `::warning title=Node patch available::${message}`, code: 0 }
    : { line: `::error title=Node patch available::${message}`, code: 1 };
}

/** The line to print and the exit code, for the end of `major`'s line against `today` (a Date). */
export function eolVerdict(major, schedule, today, { eolDays, warnOnly = false }) {
  const end = schedule?.[`v${major}`]?.end;
  const endMs = typeof end === 'string' ? Date.parse(`${end}T00:00:00Z`) : NaN;
  if (Number.isNaN(endMs)) return { line: `::error::The Node release schedule has no end date for ${major}.x.`, code: 1 };
  const daysLeft = Math.ceil((endMs - today.getTime()) / DAY_MS);
  if (daysLeft >= eolDays) return { line: `Node ${major}.x ends on ${end}, in ${daysLeft} days.`, code: 0 };
  const message =
    `Node ${major}.x ends on ${end}, in ${daysLeft} days, after which it gets no security releases. ` +
    'Move to the next LTS line, and file the move as a tech-debt issue: https://github.com/nodejs/Release#release-schedule';
  return warnOnly
    ? { line: `::warning title=Node line ends soon::${message}`, code: 0 }
    : { line: `::error title=Node line ends soon::${message}`, code: 1 };
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

async function main() {
  const { values } = parseArgs({
    options: {
      nvmrc: { type: 'string', default: '.nvmrc' },
      'warn-only': { type: 'boolean', default: false },
      'eol-days': { type: 'string', default: '0' },
    },
  });
  const warnOnly = values['warn-only'];
  try {
    const eolDays = Number(values['eol-days']);
    if (!Number.isInteger(eolDays) || eolDays < 0) throw new Error(`--eol-days must be a whole number of days, found "${values['eol-days']}"`);
    const text = readFileSync(values.nvmrc, 'utf8');
    const pinned = parseVersion(text);
    if (!pinned) throw new Error(`${values.nvmrc} must be an exact x.y.z version, found "${text.trim()}"`);
    const index = await fetchJson(INDEX_URL);
    if (!Array.isArray(index)) throw new Error(`${INDEX_URL} did not return a list of releases`);
    const results = [verdict(pinned, latestOfMajor(index, pinned[0]), { warnOnly, file: values.nvmrc })];
    if (eolDays > 0) results.push(eolVerdict(pinned[0], await fetchJson(SCHEDULE_URL), new Date(), { eolDays, warnOnly }));
    let code = 0;
    for (const result of results) {
      console.log(result.line);
      code = Math.max(code, result.code);
    }
    return code;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    console.log(`::${warnOnly ? 'warning' : 'error'}::${text}`);
    return warnOnly ? 0 : 1;
  }
}

// Importing this file (the test does) must not fetch anything.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href) {
  process.exitCode = await main();
}
