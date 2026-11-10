#!/usr/bin/env node
/**
 * The facts of a dependency update, for the advisory review (#81).
 *
 *   node facts.mjs [--lockfile package-lock.json] [--base-ref HEAD^1] [--out facts.json]
 *
 * This runs in a job with no secret, on the pull request's checkout. It
 * reads, and never runs, what is there: no install, no script of the
 * repository. What it writes is what the review job may know:
 *
 *   - each package whose top-level version changed, and whether a 0.x
 *     package moved a minor version (which semver lets break)
 *   - each nested copy that the update adds (lockfile-nesting-check)
 *   - where each changed package is named in the repository (git grep)
 *   - the title and the body of the pull request, which carry the release
 *     notes. These are untrusted text, and the review treats them as data.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { newNestedCopies } from '../lockfile-nesting-check/lockfile-nesting.mjs';

const TOP = 'node_modules/';
/** Bounds on what goes to the model, so that a large repository or body cannot make the request huge. */
export const LIMITS = { sitesPerPackage: 20, packages: 30, body: 20_000, title: 300 };

/** The top-level packages of a lockfile, as name to version. */
function topLevel(lock) {
  const found = new Map();
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    if (!key.startsWith(TOP) || key.indexOf(TOP, TOP.length) !== -1 || entry?.link) continue;
    found.set(key.slice(TOP.length), entry?.version ?? null);
  }
  return found;
}

/** Whether `from` to `to` is a minor move of a 0.x package, which semver lets break. */
export function isZeroMinor(from, to) {
  const a = /^0\.(\d+)\./.exec(from ?? '');
  const b = /^0\.(\d+)\./.exec(to ?? '');
  return Boolean(a && b && a[1] !== b[1]);
}

/** Each top-level package whose version changed, was added, or was removed, sorted by name. */
export function changedPackages(base, head) {
  const before = topLevel(base);
  const after = topLevel(head);
  const names = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changed = [];
  for (const name of names) {
    const from = before.get(name) ?? null;
    const to = after.get(name) ?? null;
    if (from === to) continue;
    changed.push({ name, from, to, zeroMinor: isZeroMinor(from, to) });
  }
  return changed;
}

/** The files and lines that name `pkg` in quotes, from `git grep`. The name is an argument, never shell text. */
export function importSites(pkg, cwd, limit = LIMITS.sitesPerPackage) {
  let out = '';
  try {
    out = execFileSync(
      'git',
      ['grep', '-n', '-I', '-F', '-e', `'${pkg}`, '-e', `"${pkg}`, '--', '.', ':!*package-lock.json', ':!*CHANGELOG.md'],
      { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (error) {
    // git grep exits 1 when nothing matches; anything else is a real failure.
    if (error?.status !== 1) throw error;
  }
  return out
    .split('\n')
    .filter(Boolean)
    .slice(0, limit)
    .map((line) => {
      const [file, lineNumber] = line.split(':', 2);
      return { file, line: Number(lineNumber) };
    });
}

/** The whole fact sheet. */
export function collect({ base, head, event, cwd }) {
  const pr = event?.pull_request ?? {};
  const packages = changedPackages(base, head).slice(0, LIMITS.packages);
  return {
    pullRequest: {
      number: pr.number ?? null,
      author: pr.user?.login ?? null,
      title: String(pr.title ?? '').slice(0, LIMITS.title),
      body: String(pr.body ?? '').slice(0, LIMITS.body),
      headSha: pr.head?.sha ?? null,
    },
    packages: packages.map((p) => ({ ...p, sites: importSites(p.name, cwd) })),
    nestedCopies: newNestedCopies(base, head),
  };
}

/** Reads the lockfile and its base, collects, and writes `out`. Returns the exit code. */
export function run({ cwd = process.cwd(), lockfile = 'package-lock.json', baseRef = 'HEAD^1', out = 'dependabot-review-facts.json', eventPath = process.env.GITHUB_EVENT_PATH } = {}) {
  try {
    const head = JSON.parse(readFileSync(path.resolve(cwd, lockfile), 'utf8'));
    const base = JSON.parse(execFileSync('git', ['show', `${baseRef}:./${lockfile}`], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    const event = eventPath ? JSON.parse(readFileSync(eventPath, 'utf8')) : {};
    const facts = collect({ base, head, event, cwd });
    writeFileSync(path.resolve(cwd, out), `${JSON.stringify(facts, null, 2)}\n`);
    console.log(`${out}: ${facts.packages.length} changed packages, ${facts.nestedCopies.length} new nested copies.`);
    return 0;
  } catch (error) {
    console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

// Importing this file (the test does) must not read anything.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href) {
  const { values } = parseArgs({
    options: {
      lockfile: { type: 'string', default: 'package-lock.json' },
      'base-ref': { type: 'string', default: 'HEAD^1' },
      out: { type: 'string', default: 'dependabot-review-facts.json' },
    },
  });
  process.exitCode = run({ lockfile: values.lockfile, baseRef: values['base-ref'], out: values.out });
}
