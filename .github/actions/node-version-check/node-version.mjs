#!/usr/bin/env node
/**
 * Whether `.nvmrc` and the Node ranges in `package.json` agree (#100).
 *
 *   node node-version.mjs [--nvmrc .nvmrc] [--package-json package.json] [--engines-major]
 *
 * repo-template writes the Node version in three places: `.nvmrc`,
 * `engines.node`, and the `node` entry of `devEngines.runtime`. A range such
 * as `>=26.0.0` also accepts the next major, so `.nvmrc` can move to a new
 * major while `package.json` stays behind, and no other check fails. Thus:
 *
 *   devEngines      `.nvmrc` is in the range, and the lower bound of the
 *                   range is on the major of `.nvmrc`. It is the Node of the
 *                   people who work on the repository.
 *   engines.node    `.nvmrc` is in the range. With --engines-major, the lower
 *                   bound is on that major too. An app's `engines` is its own
 *                   toolchain, but a library's says which Node its users can
 *                   run, and is older on purpose (pcre2-wasm-utf16:
 *                   `>=22.6.0` with Node 26 in `.nvmrc`).
 *
 * A field that is not there is skipped with a notice, so that a repository
 * can run the check before it has all three.
 *
 * The range reader is small, not npm's semver, because a script here has no
 * dependencies (ADR 0002). It reads comparators separated by spaces, which
 * must all hold, each with npm's meaning. It refuses `||`, hyphen ranges,
 * wildcards and prerelease tags rather than guess: a range that it cannot
 * read is a range that it cannot compare.
 */
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

/** The forms that `parseRange` reads, for the message that refuses a range. */
export const FORMS =
  'The check reads comparators separated by spaces, which must all hold: >=, >, <=, <, =, ^ or ~ before a version, ' +
  'or a bare version. A version is x, x.y or x.y.z, with no wildcard and no prerelease tag.';

const COMPARATOR = /^(>=|<=|>|<|=|\^|~)?v?(\d+)(?:\.(\d+)(?:\.(\d+))?)?$/;

/** "v26.13.0" or "26.13.0" to [26, 13, 0]; null when it is not a plain x.y.z. */
export function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Negative, zero or positive, as Array.prototype.sort wants. */
export function compareVersions(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * The comparators of one written comparator, with npm's meaning for a
 * version of one or two parts: `^26.1` is `>=26.1.0 <27.0.0`, `~26.1` is
 * `>=26.1.0 <26.2.0`, `26` is `>=26.0.0 <27.0.0`, and `>26` is `>=27.0.0`.
 */
function expand(op, parts) {
  const [major, minor, patch] = parts;
  const low = [major, minor ?? 0, patch ?? 0];
  const exact = parts.length === 3;
  // The end of the line that the parts name, as npm reads `~`: 26 to
  // 27.0.0, and 26.1 or 26.1.3 to 26.2.0.
  const next = parts.length === 1 ? [major + 1, 0, 0] : [major, minor + 1, 0];
  switch (op) {
    case '>=':
    case '<':
      return [{ op, version: low }];
    case '>':
      return exact ? [{ op, version: low }] : [{ op: '>=', version: next }];
    case '<=':
      return exact ? [{ op, version: low }] : [{ op: '<', version: next }];
    case '~':
      return [{ op: '>=', version: low }, { op: '<', version: next }];
    case '^': {
      // npm moves the first part that is not zero, of the parts given, so
      // `^0.2` stays below 0.3.0.
      const upper = major > 0 || parts.length === 1 ? [major + 1, 0, 0] : minor > 0 || parts.length === 2 ? [0, minor + 1, 0] : [0, 0, patch + 1];
      return [{ op: '>=', version: low }, { op: '<', version: upper }];
    }
    default:
      return exact ? [{ op: '=', version: low }] : [{ op: '>=', version: low }, { op: '<', version: next }];
  }
}

/**
 * The comparators of a range, each `{ op, version }` with `op` one of `>=`,
 * `>`, `<=`, `<` and `=`, all of which must hold. Throws an Error that says
 * why, for a range in a form that it does not read.
 */
export function parseRange(text) {
  if (typeof text !== 'string') throw new Error('it is not a string');
  if (text.includes('||')) throw new Error('it has "||", and the check reads one set of comparators only');
  if (/\s-\s/.test(text)) throw new Error('it is a hyphen range');
  // npm allows a space between the operator and the version.
  const tokens = text.replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) throw new Error('it is empty');
  return tokens.flatMap((token) => {
    const match = COMPARATOR.exec(token);
    if (match) return expand(match[1] ?? '', match.slice(2).filter((part) => part !== undefined).map(Number));
    if (/(^|[^0-9A-Za-z])[xX*]($|[^0-9A-Za-z])/.test(token)) throw new Error(`"${token}" has a wildcard`);
    if (/\d[-+]/.test(token)) throw new Error(`"${token}" has a prerelease tag or build metadata`);
    throw new Error(`"${token}" is not a comparator`);
  });
}

const HOLDS = {
  '>=': (order) => order >= 0,
  '>': (order) => order > 0,
  '<=': (order) => order <= 0,
  '<': (order) => order < 0,
  '=': (order) => order === 0,
};

/** Whether `version` holds for each of the comparators. */
export function satisfies(version, comparators) {
  return comparators.every(({ op, version: bound }) => HOLDS[op](compareVersions(version, bound)));
}

/** The highest version of the `>=`, `>` and `=` comparators, or null when the range has no lower bound. */
export function lowerBound(comparators) {
  let low = null;
  for (const { op, version } of comparators) {
    if (op === '<' || op === '<=') continue;
    if (low === null || compareVersions(version, low) > 0) low = version;
  }
  return low;
}

/**
 * The Node ranges that `manifest` gives, as `{ field, text, major }`, where
 * `major` says whether the lower bound must be on the major of `.nvmrc`.
 * `skipped` names each field that is not there, and `problems` each field
 * that is not of a shape that the check can read.
 */
export function nodeRanges(manifest, { enginesMajor = false } = {}) {
  const ranges = [];
  const skipped = [];
  const problems = [];
  const runtime = manifest.devEngines?.runtime;
  if (runtime === undefined) {
    skipped.push('devEngines.runtime');
  } else if (runtime === null || typeof runtime !== 'object') {
    problems.push(`devEngines.runtime is ${JSON.stringify(runtime)}. Write an object such as { "name": "node", "version": ">=26.0.0" }, or a list of them.`);
  } else {
    const entries = Array.isArray(runtime) ? runtime.map((entry, i) => [`devEngines.runtime[${i}]`, entry]) : [['devEngines.runtime', runtime]];
    const node = entries.filter(([, entry]) => entry?.name === 'node');
    if (node.length === 0) skipped.push('devEngines.runtime entry with "name": "node"');
    for (const [where, entry] of node) {
      if (entry.version === undefined) skipped.push(`${where}.version`);
      else ranges.push({ field: `${where}.version`, text: entry.version, major: true });
    }
  }
  const engines = manifest.engines?.node;
  if (engines === undefined) skipped.push('engines.node');
  else ranges.push({ field: 'engines.node', text: engines, major: enginesMajor });
  return { ranges, skipped, problems };
}

/** What is wrong with one range for the version `pinned` in the file `nvmrc`, or null. */
export function rangeProblem(pinned, { field, text, major }, nvmrc = '.nvmrc') {
  const pinnedText = pinned.join('.');
  const shown = `${field} is ${JSON.stringify(text)}`;
  const example = `>=${pinned[0]}.0.0`;
  let comparators;
  try {
    comparators = parseRange(text);
  } catch (error) {
    return `${shown}, which the check cannot read: ${error.message}. ${FORMS} For example "${example}".`;
  }
  if (!satisfies(pinned, comparators)) {
    return major
      ? `${shown}, which does not accept Node ${pinnedText} from ${nvmrc}. Write a range that accepts it, with its lower bound on Node ${pinned[0]}, for example "${example}".`
      : `${shown}, which does not accept Node ${pinnedText} from ${nvmrc}. Write a range that accepts it, or set ${nvmrc} to a version in the range.`;
  }
  if (!major) return null;
  const low = lowerBound(comparators);
  if (low === null) {
    return `${shown}, which has no lower bound, so it does not say which Node major it is for. Give it a lower bound on Node ${pinned[0]}, for example "${example} ${text.trim()}".`;
  }
  if (low[0] !== pinned[0]) {
    return `${shown}, whose lower bound is on Node ${low[0]}, but ${nvmrc} pins Node ${pinnedText}. Raise the lower bound to Node ${pinned[0]}, for example "${example}".`;
  }
  return null;
}

/** Workflow-command data, escaped as the syntax requires, since the text comes from the caller's files. */
const escapeData = (text) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/** One `::error` or `::notice` line on `file`. */
export function annotation(level, file, message) {
  return `::${level} file=${escapeData(file).replace(/:/g, '%3A').replace(/,/g, '%2C')}::${escapeData(message)}`;
}

/** The lines to print and the exit code, for the version `pinned` against the parsed `manifest`. */
export function check(pinned, manifest, { enginesMajor = false, nvmrc = '.nvmrc', packageJson = 'package.json' } = {}) {
  const { ranges, skipped, problems } = nodeRanges(manifest, { enginesMajor });
  const lines = skipped.map((field) => annotation('notice', packageJson, `${packageJson} has no ${field}, so the check skips it.`));
  const errors = problems.map((problem) => annotation('error', packageJson, problem));
  const compared = [];
  for (const range of ranges) {
    const problem = rangeProblem(pinned, range, nvmrc);
    if (problem) errors.push(annotation('error', packageJson, problem));
    else compared.push(`${range.field} ${JSON.stringify(range.text)} (${range.major ? 'range and major' : 'range'})`);
  }
  if (errors.length > 0) return { lines: [...lines, ...errors], code: 1 };
  const pinnedText = `${nvmrc} (${pinned.join('.')})`;
  const verdict = compared.length > 0 ? `${pinnedText} agrees with ${compared.join(' and ')}.` : `${packageJson} gives no Node range to compare with ${pinnedText}.`;
  return { lines: [...lines, verdict], code: 0 };
}

/** The text of `file` under `root`, or the reason that the check cannot read it. */
function readText(root, file, hint) {
  try {
    return { text: readFileSync(path.join(root, file), 'utf8') };
  } catch (error) {
    return { problem: error.code === 'ENOENT' ? `${file} does not exist. ${hint}` : `${file} cannot be read: ${error.message}.` };
  }
}

/** The version that `file` pins, or the reason that the check cannot read it. */
function readPinned(root, file) {
  const { text, problem } = readText(root, file, 'Write the exact Node version in it, as x.y.z, or give its path with nvmrc.');
  if (problem) return { problem };
  const version = parseVersion(text);
  return version ? { value: version } : { problem: `${file} must hold one exact x.y.z version, found ${JSON.stringify(text.trim())}.` };
}

/** The manifest in `file`, or the reason that the check cannot read it. */
function readManifest(root, file) {
  const { text, problem } = readText(root, file, 'Run the check where package.json is, or give its path with package-json.');
  if (problem) return { problem };
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    return { problem: `${file} is not valid JSON: ${error.message}.` };
  }
  return manifest !== null && typeof manifest === 'object' && !Array.isArray(manifest) ? { value: manifest } : { problem: `${file} must hold a JSON object.` };
}

/** The check of the two files, with paths relative to `root`. Reports a problem with each file before it stops. */
export function run(root = '.', { nvmrc = '.nvmrc', packageJson = 'package.json', enginesMajor = false } = {}) {
  const pinned = readPinned(root, nvmrc);
  const manifest = readManifest(root, packageJson);
  const errors = [
    ...(pinned.problem ? [annotation('error', nvmrc, pinned.problem)] : []),
    ...(manifest.problem ? [annotation('error', packageJson, manifest.problem)] : []),
  ];
  if (errors.length > 0) return { lines: errors, code: 1 };
  return check(pinned.value, manifest.value, { enginesMajor, nvmrc, packageJson });
}

// Importing this file (the test does) must not read the working directory.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href) {
  const { values } = parseArgs({
    options: {
      nvmrc: { type: 'string', default: '.nvmrc' },
      'package-json': { type: 'string', default: 'package.json' },
      'engines-major': { type: 'boolean', default: false },
    },
  });
  const { lines, code } = run('.', { nvmrc: values.nvmrc, packageJson: values['package-json'], enginesMajor: values['engines-major'] });
  for (const line of lines) console.log(line);
  process.exitCode = code;
}
