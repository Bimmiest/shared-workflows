#!/usr/bin/env node
/**
 * Whether a pull request adds a nested copy of a package to a lockfile (#80).
 *
 *   node lockfile-nesting.mjs [--lockfile package-lock.json]
 *                             [--base <file> | --base-ref HEAD^1] [--level warn|fail]
 *
 * A nested copy, `node_modules/a/node_modules/b`, says that the top level
 * could not take the version that `a` asks for. `npm ci` then installs `b`
 * with a peer dependency that is not satisfied, and the checks can stay
 * green. A copy under a workspace, `packages/x/node_modules/b`, says the same
 * when the root has `b` too. Reading the lockfile diff of each update for
 * this was a reviewer's memory; this reads it each time.
 *
 * Only a copy that the base did not have is reported: a nesting that is
 * already on main is not the pull request's to fix. The base is a file, or
 * the lockfile at a git revision. In a pull request's merge checkout,
 * `HEAD^1` is the base branch, so a checkout with `fetch-depth: 2` is enough.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const NODE_MODULES = 'node_modules/';

/** The package name at the end of a lockfile key: `a/node_modules/@s/b` is `@s/b`. */
export function packageName(key) {
  return key.slice(key.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);
}

/**
 * Whether a key of `packages` is a nested copy: under another package, or
 * under a workspace while the root has the same package.
 */
export function isNestedCopy(key, packages) {
  const at = key.lastIndexOf(NODE_MODULES);
  if (at === -1 || packages[key]?.link) return false;
  if (key.indexOf(NODE_MODULES) !== at) return true;
  return at > 0 && Object.hasOwn(packages, `${NODE_MODULES}${packageName(key)}`);
}

/** Each nested copy in `head` that `base` did not have, with the version at the top level. */
export function newNestedCopies(base, head) {
  const before = base?.packages ?? {};
  const after = head?.packages ?? {};
  const found = [];
  for (const [key, entry] of Object.entries(after)) {
    if (Object.hasOwn(before, key) || !isNestedCopy(key, after)) continue;
    const name = packageName(key);
    found.push({ name, path: key, nested: entry?.version ?? null, top: after[`${NODE_MODULES}${name}`]?.version ?? null });
  }
  return found;
}

/** The lines to print and the exit code. */
export function verdict(copies, { level = 'warn', file = 'package-lock.json' } = {}) {
  if (copies.length === 0) return { lines: [`${file}: no new nested copy of a package.`], code: 0 };
  const kind = level === 'fail' ? 'error' : 'warning';
  const lines = copies.map(
    (c) =>
      `::${kind} file=${file},title=Nested copy of ${c.name}::${c.path} is ${c.name} ${c.nested ?? '(no version)'}, ` +
      `and the top level has ${c.top ?? 'none'}. The top level cannot take this version, so a peer dependency ` +
      'may not be satisfied. Run `npm dedupe`, or update the related packages in one change.',
  );
  return { lines, code: level === 'fail' ? 1 : 0 };
}

/** Checks one lockfile against its base, prints the result, and returns the exit code. */
export function run({ cwd = process.cwd(), lockfile = 'package-lock.json', base, baseRef = 'HEAD^1', level = 'warn' } = {}) {
  try {
    if (level !== 'warn' && level !== 'fail') throw new Error(`--level must be warn or fail, found "${level}"`);
    const head = JSON.parse(readFileSync(path.resolve(cwd, lockfile), 'utf8'));
    const baseText =
      base === undefined
        ? execFileSync('git', ['show', `${baseRef}:./${lockfile}`], { cwd, encoding: 'utf8' })
        : readFileSync(path.resolve(cwd, base), 'utf8');
    const { lines, code } = verdict(newNestedCopies(JSON.parse(baseText), head), { level, file: lockfile });
    for (const line of lines) console.log(line);
    return code;
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
      base: { type: 'string' },
      'base-ref': { type: 'string', default: 'HEAD^1' },
      level: { type: 'string', default: 'warn' },
    },
  });
  process.exitCode = run({ lockfile: values.lockfile, base: values.base, baseRef: values['base-ref'], level: values.level });
}
