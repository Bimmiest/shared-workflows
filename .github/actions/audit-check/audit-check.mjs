#!/usr/bin/env node
/**
 * The advisory gate on production dependencies, with a place to write down an
 * accepted advisory (propslab-ent #1603).
 *
 *   node audit-check.mjs [--exceptions .audit-exceptions.json] [--omit dev] [--level high]
 *
 * It replaces `npm audit --omit=dev --audit-level=high`, which left two
 * choices when a high advisory could not be fixed: a red `main`, or a lower
 * floor for everything. This keeps the floor and reads an exceptions file for
 * the advisories somebody has argued are not reachable. Each entry carries a
 * reason and an expiry, and an expired entry fails the step: an acceptance is
 * a judgement about a moment, and it gets re-made rather than inherited. So
 * does an entry the report no longer needs, so the file cannot rot.
 *
 * The exceptions file:
 *
 *   { "exceptions": [ { "id": "GHSA-xxxx-xxxx-xxxx", "package": "name",
 *                       "reason": "why nothing reachable is exposed",
 *                       "expires": "YYYY-MM-DD" } ] }
 *
 * A missing file is an empty list. `npm audit fix --force` is never the
 * remedy: advisories get read, not auto-applied.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const ORDER = ['info', 'low', 'moderate', 'high', 'critical'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The severities at or above `level`, which is `--audit-level`'s meaning. */
export function gatedSeverities(level) {
  const at = ORDER.indexOf(level);
  if (at === -1) throw new Error(`Unknown audit level "${level}"; one of ${ORDER.join(', ')}.`);
  return new Set(ORDER.slice(at));
}

/**
 * Every advisory in an `npm audit --json` report, once each. A vulnerability's
 * `via` holds advisory objects for its own advisories and bare package names
 * for what it inherits; the inherited ones are reported again under the
 * package they are against, so only the objects are read.
 */
export function advisories(report) {
  const seen = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via !== 'object' || via === null) continue;
      const ghsa = /GHSA(?:-[0-9a-z]{4}){3}/.exec(via.url ?? '')?.[0];
      const id = ghsa ?? String(via.source);
      const key = `${id} ${via.name}`;
      if (!seen.has(key)) seen.set(key, { id, package: via.name, severity: via.severity, title: via.title, url: via.url });
    }
  }
  return [...seen.values()];
}

/** Malformed and expired entries, as sentences. `today` is `YYYY-MM-DD`. */
export function exceptionProblems(exceptions, today, file = '.audit-exceptions.json') {
  const out = [];
  exceptions.forEach((entry, index) => {
    const label = entry?.id ? `\`${entry.id}\`` : `entry ${index + 1}`;
    for (const field of ['id', 'package', 'reason', 'expires']) {
      if (typeof entry?.[field] !== 'string' || entry[field].trim() === '') out.push(`${file} ${label} has no \`${field}\`.`);
    }
    if (typeof entry?.expires !== 'string') return;
    if (!DATE.test(entry.expires) || Number.isNaN(Date.parse(entry.expires))) {
      out.push(`${file} ${label} expires \`${entry.expires}\`, which is not a YYYY-MM-DD date.`);
    } else if (entry.expires < today) {
      out.push(`${file} ${label} (${entry.package}) expired on ${entry.expires}. Fix the advisory, or re-read it and write a new reason and date.`);
    }
  });
  return out;
}

/** The verdict on one report against the exceptions, as lines and an exit code. */
export function check(report, { exceptions = [] } = {}, { today, gated = gatedSeverities('high'), file = '.audit-exceptions.json' } = {}) {
  if (report.error) {
    return { lines: [`::error::npm audit failed: ${report.error.summary ?? report.error.code ?? JSON.stringify(report.error)}`], code: 1 };
  }
  const lines = exceptionProblems(exceptions, today, file).map((problem) => `::error::${problem}`);
  const found = advisories(report);
  const used = new Set();
  let gatedCount = 0;
  for (const advisory of found) {
    if (!gated.has(advisory.severity)) continue;
    gatedCount += 1;
    const excepted = exceptions.findIndex((entry) => entry?.id === advisory.id && entry?.package === advisory.package);
    if (excepted !== -1) {
      used.add(excepted);
      continue;
    }
    lines.push(
      `::error::${advisory.severity} ${advisory.id} in ${advisory.package}: ${advisory.title} (${advisory.url}). Upgrade past it, or, if nothing reachable is exposed, list it in ${file} with the reason and an expiry.`,
    );
  }
  // An exception nothing matches is an approval waiting for the next
  // advisory of that name; it goes when the need does.
  exceptions.forEach((entry, index) => {
    if (!used.has(index) && typeof entry?.id === 'string') {
      lines.push(`::error::${file} lists \`${entry.id}\` (${entry.package}), which the report no longer contains. Remove it.`);
    }
  });
  if (lines.length) return { lines, code: 1 };
  const below = found.length - gatedCount;
  const floor = [...gated][0];
  return {
    lines: [
      `No ${floor} or worse advisory in production dependencies${gatedCount ? ` beyond the ${gatedCount} excepted in ${file}` : ''}${below ? `; ${below} below the floor, not gated` : ''}.`,
    ],
    code: 0,
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      exceptions: { type: 'string', default: '.audit-exceptions.json' },
      omit: { type: 'string', default: 'dev' },
      level: { type: 'string', default: 'high' },
    },
  });
  const args = ['audit', '--json'];
  if (values.omit) args.push(`--omit=${values.omit}`);
  // npm audit exits non-zero whenever it finds anything, at any severity; the
  // verdict is this script's, from the JSON, not npm's exit code.
  const audit = spawnSync('npm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    console.log(`::error::npm audit printed no JSON report (exit ${audit.status}).`);
    console.log(audit.stderr);
    return 1;
  }
  const exceptions = existsSync(values.exceptions) ? JSON.parse(readFileSync(values.exceptions, 'utf8')) : { exceptions: [] };
  const { lines, code } = check(report, exceptions, {
    today: new Date().toISOString().slice(0, 10),
    gated: gatedSeverities(values.level),
    file: values.exceptions,
  });
  for (const line of lines) console.log(line);
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main();
}
