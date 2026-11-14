#!/usr/bin/env node
/**
 * Whether a version that a repository pins in a file of its own is the
 * newest release of its upstream (#39).
 *
 *   node upstream-release.mjs --repository owner/name --file build/build.sh
 *     --pattern '^PCRE2_VERSION=(.+)$' --tag-pattern '^pcre2-(.+)$' [--warn-only]
 *
 * pcre2-wasm-utf16 pins PCRE2 with a version and a checksum in a shell
 * script. Dependabot does not read that file, so a PCRE2 security release
 * goes unnoticed until a person looks. This asks GitHub for the releases of
 * the upstream and says so when the pin is behind. It never changes the pin:
 * a person must read the new checksum, and the build must run again.
 *
 *   default      exit 1 when behind: the scheduled run, where a red run is
 *                the reminder
 *   --warn-only  print a ::warning:: and exit 0: pull requests, where an
 *                unrelated change must not fail on a release that shipped
 *                this morning
 *
 * The releases, not the tags: only a release says whether it is a draft or a
 * prerelease, and an upstream tags its release candidates too (PCRE2 has
 * `pcre2-10.48-RC1`). Drafts and prereleases are skipped. Not
 * `/releases/latest`: that is the release marked latest, which by default is
 * the one created last, so a backport on an older line would hide a newer
 * version.
 *
 * A version is dotted numbers, with an optional `v`: `10.48`, `v1.2.3`. Two
 * versions compare part by part as numbers, and a missing part is 0, so
 * `10.48` equals `10.48.0`. A release whose tag matches the tag pattern but
 * whose version is not dotted numbers (`10.48-RC1`, a release candidate not
 * marked as a prerelease) is skipped and named in the log: it cannot be
 * ordered against the pin, and a candidate is not a release to move to. A
 * pin that is not dotted numbers is an error. A request that fails, or an
 * upstream with no release to compare, is an error too, except under
 * --warn-only: a reminder that silently stops firing is the failure it
 * exists to prevent.
 *
 * The token is `GH_TOKEN`, and is optional. GITHUB_TOKEN reads the releases
 * of any public repository, at a higher rate limit than no token.
 */
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

// shortcut: one page, the 100 releases created last. A newer version is in
// it unless the upstream created 100 releases after that version. Read more
// pages if an upstream does.
const PER_PAGE = 100;

/** "10.48", "v1.2.3" or " 1.2 " to [10, 48], [1, 2, 3] or [1, 2]; null when it is not dotted numbers. */
export function parseVersion(text) {
  const match = /^v?(\d+(?:\.\d+)*)$/.exec(text.trim());
  return match ? match[1].split('.').map(Number) : null;
}

/** Negative, zero or positive, as Array.prototype.sort wants. A missing part is 0. */
export function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** A RegExp from text that a caller wrote, or an Error that names the input. */
function compile(source, input, flags = '') {
  try {
    return new RegExp(source, flags);
  } catch (error) {
    throw new Error(`${input} is not a regular expression: ${error.message}`);
  }
}

/**
 * The pinned version, as the text of capture group 1 of `pattern` in `text`.
 * `^` and `$` match at each line. The pattern must match exactly one line,
 * so that a second pin in the file cannot be the one that is not checked.
 */
export function readPin(text, pattern, file) {
  const matches = [...text.matchAll(compile(pattern, '--pattern', 'gm'))];
  if (matches.length === 0) throw new Error(`No line of ${file} matches the pattern ${pattern}.`);
  if (matches.length > 1) throw new Error(`${matches.length} lines of ${file} match the pattern ${pattern}. Make it match the one line of the pin.`);
  const value = matches[0][1];
  if (value === undefined) throw new Error(`The pattern ${pattern} has no capture group 1 for the version.`);
  return value.trim();
}

/**
 * The newest release in `releases` (the answer of GET /repos/{owner}/{repo}/releases),
 * as `{ tag, text, version, url }`, or null. Drafts, prereleases and tags
 * that `tagPattern` does not match are left out. `skipped` names each tag
 * that matches but whose version is not dotted numbers.
 */
export function newestRelease(releases, tagPattern) {
  const tagRegExp = compile(tagPattern, '--tag-pattern');
  let newest = null;
  const skipped = [];
  for (const release of releases) {
    if (release?.draft || release?.prerelease || typeof release?.tag_name !== 'string') continue;
    const text = tagRegExp.exec(release.tag_name)?.[1];
    if (text === undefined) continue;
    const version = parseVersion(text);
    if (!version) {
      skipped.push(release.tag_name);
      continue;
    }
    if (newest === null || compareVersions(version, newest.version) > 0) {
      newest = { tag: release.tag_name, text: text.trim(), version, url: release.html_url };
    }
  }
  return { newest, skipped };
}

/** The line to print and the exit code, for the pin against the newest release. */
export function verdict(pin, newest, { repository, file, tagPattern, warnOnly = false }) {
  if (!newest) {
    const message = `${repository} has no release, other than drafts and prereleases, whose tag matches ${tagPattern} with a version of dotted numbers.`;
    return { line: `::error::${message} Correct the tag pattern.`, code: 1 };
  }
  const pinned = parseVersion(pin);
  if (!pinned) return { line: `::error::${file} pins "${pin}", which is not a version of dotted numbers. Correct the pattern.`, code: 1 };
  if (compareVersions(pinned, newest.version) >= 0) {
    return { line: `${file} pins ${repository} ${pin}. The newest release is ${newest.text} (${newest.tag}).`, code: 0 };
  }
  const message =
    `${file} pins ${repository} ${pin}, but ${newest.text} (${newest.tag}) is out. Read the release notes for security fixes, ` +
    `then change the pin by hand, with its checksum if it has one, and run the build again: ${newest.url}`;
  return warnOnly
    ? { line: `::warning title=Upstream release available::${message}`, code: 0 }
    : { line: `::error title=Upstream release available::${message}`, code: 1 };
}

/** The releases of `repository`, through `fetchImpl`. Throws on an answer that is not a list. */
export async function fetchReleases(repository, { fetchImpl = fetch, apiUrl = 'https://api.github.com', token } = {}) {
  const url = `${apiUrl}/repos/${repository}/releases?per_page=${PER_PAGE}`;
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}${body?.message ? ` (${body.message})` : ''}.`);
  if (!Array.isArray(body)) throw new Error(`${url} did not return a list of releases.`);
  return body;
}

/**
 * The whole check, for the arguments in `args`. Returns the exit code, and
 * prints through `log`. The test gives its own `fetchImpl`, `readFile` and `env`.
 */
export async function run(args, { fetchImpl = fetch, readFile = (file) => readFileSync(file, 'utf8'), env = process.env, log = console.log } = {}) {
  let warnOnly = false;
  try {
    const { values } = parseArgs({
      args,
      options: {
        repository: { type: 'string', default: '' },
        file: { type: 'string', default: '' },
        pattern: { type: 'string', default: '' },
        'tag-pattern': { type: 'string', default: '^v?(.+)$' },
        'warn-only': { type: 'boolean', default: false },
      },
    });
    warnOnly = values['warn-only'];
    for (const name of ['repository', 'file', 'pattern']) {
      if (!values[name]) throw new Error(`No --${name}. Give the upstream as owner/name, the file of the pin, and the pattern with the version in group 1.`);
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(values.repository)) throw new Error(`--repository must be owner/name, found "${values.repository}".`);
    const tagPattern = values['tag-pattern'];
    const pin = readPin(readFile(values.file), values.pattern, values.file);
    const releases = await fetchReleases(values.repository, { fetchImpl, apiUrl: env.GITHUB_API_URL || undefined, token: env.GH_TOKEN });
    const { newest, skipped } = newestRelease(releases, tagPattern);
    if (skipped.length) log(`Skipped the releases whose version is not dotted numbers: ${skipped.join(', ')}.`);
    const result = verdict(pin, newest, { repository: values.repository, file: values.file, tagPattern, warnOnly });
    log(result.line);
    return result.code;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    log(`::${warnOnly ? 'warning' : 'error'}::${text}`);
    return warnOnly ? 0 : 1;
  }
}

// Importing this file (the test does) must not fetch anything.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href) {
  process.exitCode = await run(process.argv.slice(2));
}
