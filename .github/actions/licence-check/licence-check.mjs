#!/usr/bin/env node
/**
 * Whether every production dependency is licensed under something this
 * repository has agreed to ship (propslab-ent #1603).
 *
 *   node licence-check.mjs [--lockfile package-lock.json] [--allowlist .licence-allowlist.json]
 *
 * **Production** is what `npm ci --omit=dev` installs, so a lockfile entry
 * marked `dev` or `devOptional` is not read. Optional packages (platform
 * binaries) are, because they ship where they apply.
 *
 * **The lockfile is the source**, not `node_modules` and not a new dependency:
 * npm records each package's `license` field in `package-lock.json`, so this
 * reads exactly what `npm ci` would install and needs no install to run. A
 * package whose manifest declares no licence has none recorded, and fails
 * until somebody reads its LICENSE file and writes what they found into the
 * allowlist against that version.
 *
 * The allowlist:
 *
 *   { "licences": ["MIT", "Apache-2.0", …],
 *     "packages": { "name": { "versions": ["1.2.3"], "licence": "MIT", "reason": "…" } } }
 *
 * `licences` are SPDX identifiers accepted wherever they appear; an `OR`
 * expression passes when any branch is listed, an `AND` only when every part
 * is. `packages` is for the rest: pinned to the versions somebody actually
 * read, so a bump past a pinned version fails until the new one is read too.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

/** Every production package the lockfile installs, as `{ name, version, license, where }`. */
export function productionPackages(lock) {
  const found = [];
  for (const [where, entry] of Object.entries(lock.packages ?? {})) {
    // The root and workspace entries are this repository, not dependencies;
    // a link is a workspace seen from node_modules.
    if (!where.includes('node_modules/') || entry.link) continue;
    if (entry.dev || entry.devOptional) continue;
    const name = entry.name ?? where.slice(where.lastIndexOf('node_modules/') + 'node_modules/'.length);
    found.push({ name, version: entry.version, license: entry.license, where });
  }
  return found;
}

/**
 * Whether an SPDX expression is satisfied by the allowed identifiers. `OR`
 * needs one branch, `AND` needs all, parentheses group; `X WITH Y` is one
 * term, allowed only when written that way. The legacy array/object forms
 * some old manifests use are read as `OR` of their entries.
 */
export function satisfies(license, allowed) {
  if (Array.isArray(license)) return license.some((item) => satisfies(item, allowed));
  if (license && typeof license === 'object') return satisfies(license.type, allowed);
  if (typeof license !== 'string' || license.trim() === '') return false;

  const tokens = license.match(/\(|\)|[^\s()]+/g) ?? [];
  let at = 0;
  const peek = () => tokens[at];
  function term() {
    if (peek() === '(') {
      at += 1;
      const value = or();
      if (tokens[at] !== ')') throw new Error('unbalanced');
      at += 1;
      return value;
    }
    let id = tokens[at++];
    if (id === undefined || id === ')') throw new Error('empty');
    if (peek() === 'WITH') {
      at += 1;
      id = `${id} WITH ${tokens[at++]}`;
    }
    return allowed.has(id);
  }
  function and() {
    let value = term();
    while (peek() === 'AND') {
      at += 1;
      value = term() && value;
    }
    return value;
  }
  function or() {
    let value = and();
    while (peek() === 'OR') {
      at += 1;
      value = and() || value;
    }
    return value;
  }
  try {
    const value = or();
    return at === tokens.length && value;
  } catch {
    // An expression that does not parse is not one anybody has agreed to.
    return false;
  }
}

/** Every production package the allowlist does not cover, as sentences, plus stale package entries. */
export function problems(packages, allowlist, file = '.licence-allowlist.json') {
  const allowed = new Set(allowlist.licences ?? []);
  const named = allowlist.packages ?? {};
  const used = new Set();
  const out = [];
  for (const pkg of packages) {
    if (satisfies(pkg.license, allowed)) continue;
    const entry = named[pkg.name];
    if (entry && entry.versions?.includes(pkg.version)) {
      used.add(`${pkg.name}@${pkg.version}`);
      continue;
    }
    const recorded = pkg.license === undefined ? 'no licence recorded' : `\`${JSON.stringify(pkg.license)}\``;
    out.push(
      entry
        ? `${pkg.name}@${pkg.version} (${pkg.where}) has ${recorded}, and ${file} names only ${entry.versions?.join(', ') || 'no version'} of it. Read this version's LICENSE, then add it to \`versions\`.`
        : `${pkg.name}@${pkg.version} (${pkg.where}) has ${recorded}, which is not in ${file}. Replace the dependency, or name the package there with the licence you read and why it is acceptable.`,
    );
  }
  // An entry nothing needs any more is a standing approval for a version
  // nobody will re-read; it goes when the need does.
  for (const [name, entry] of Object.entries(named)) {
    for (const version of entry.versions ?? []) {
      if (!used.has(`${name}@${version}`)) out.push(`${file} names ${name}@${version}, which no production dependency needs. Remove it.`);
    }
  }
  return out;
}

export function run({ lock, allowlist, file }) {
  const packages = productionPackages(lock);
  const found = problems(packages, allowlist, file);
  if (found.length) return { lines: found.map((problem) => `::error::${problem}`), code: 1 };
  return { lines: [`${packages.length} production packages: every licence is on the allowlist.`], code: 0 };
}

/** A starting allowlist, printed when a repository has none yet. */
export const STARTER = {
  $comment:
    'What a production dependency may be licensed under. `licences` are SPDX identifiers accepted anywhere; `packages` names the rest, pinned to the versions somebody read, with the licence found and why it is acceptable.',
  licences: ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'BlueOak-1.0.0', 'Python-2.0', 'CC0-1.0', 'Unlicense'],
  packages: {},
};

function main() {
  const { values } = parseArgs({
    options: {
      lockfile: { type: 'string', default: 'package-lock.json' },
      allowlist: { type: 'string', default: '.licence-allowlist.json' },
    },
  });
  if (!existsSync(values.lockfile)) {
    console.log(`::error::No lockfile at ${values.lockfile}; nothing to check.`);
    return 1;
  }
  if (!existsSync(values.allowlist)) {
    console.log(`::error::No allowlist at ${values.allowlist}. Create it; this is a reasonable start:`);
    console.log(JSON.stringify(STARTER, null, 2));
    return 1;
  }
  const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
  const { lines, code } = run({ lock: read(values.lockfile), allowlist: read(values.allowlist), file: values.allowlist });
  for (const line of lines) console.log(line);
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main();
}
