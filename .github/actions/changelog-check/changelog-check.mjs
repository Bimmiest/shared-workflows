#!/usr/bin/env node
/**
 * Whether a pull request that changes what a user can notice also changes the
 * changelog (shared-workflows #9, propslab #577). Every consumer's
 * CONTRIBUTING asks for the entry and its pull request template lists it; a
 * rule in prose alone is not followed.
 *
 * Everything arrives through the environment:
 *
 *   CHANGED_FILES        the pull request's changed paths, one per line
 *   PR_LABELS            the label names, as a JSON array
 *   PR_AUTHOR            the login that opened it
 *   CL_PATHS             globs whose change needs an entry, comma-separated
 *                        (default src/**)
 *   CL_IGNORE            globs that never need one, comma-separated
 *                        (default **\/__tests__/**,**\/*.test.*)
 *   CL_CHANGELOG         the changelog's path (default CHANGELOG.md)
 *   CL_LABEL             the label that exempts a change no user can see
 *                        (default no-changelog)
 *   CL_EXEMPT_AUTHORS    logins exempt, comma-separated (default dependabot[bot])
 *
 * Prints a `::error::` annotation and exits 1, or says why it passed and exits 0.
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_PATHS = ['src/**'];
export const DEFAULT_IGNORE = ['**/__tests__/**', '**/*.test.*'];
export const DEFAULT_CHANGELOG = 'CHANGELOG.md';
export const DEFAULT_LABEL = 'no-changelog';
export const DEFAULT_EXEMPT_AUTHORS = ['dependabot[bot]'];

const matches = (file, globs) => globs.some((glob) => path.posix.matchesGlob(file, glob));

/**
 * The verdict for one pull request: `problem` is the sentence to print when
 * it fails, null when it passes, and `reason` says why it passed.
 */
export function check(
  { files, labels = [], author },
  {
    paths = DEFAULT_PATHS,
    ignore = DEFAULT_IGNORE,
    changelog = DEFAULT_CHANGELOG,
    label = DEFAULT_LABEL,
    exemptAuthors = DEFAULT_EXEMPT_AUTHORS,
  } = {},
) {
  if (exemptAuthors.includes(author)) return { problem: null, reason: `${author} is exempt.` };
  if (labels.includes(label)) return { problem: null, reason: `Labelled \`${label}\`.` };
  if (files.includes(changelog)) return { problem: null, reason: `${changelog} changed.` };
  const noticed = files.filter((file) => matches(file, paths) && !matches(file, ignore));
  if (noticed.length === 0) return { problem: null, reason: `No file under ${paths.join(', ')} changed, tests aside.` };
  const shown = noticed.slice(0, 3).map((f) => `\`${f}\``).join(', ');
  const more = noticed.length > 3 ? ` and ${noticed.length - 3} more` : '';
  return {
    problem:
      `This pull request changes ${shown}${more} and not ${changelog}. Add an entry under Unreleased that says ` +
      `what a user notices, or label the pull request \`${label}\` if no user can see the change.`,
    reason: null,
  };
}

/** A message made safe to follow `::error::` on one line. */
export function escapeCommand(message) {
  return message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

const list = (text, fallback) => {
  if (typeof text !== 'string' || text.trim() === '') return fallback;
  return text.split(',').map((s) => s.trim()).filter(Boolean);
};

/** Reads the pull request and the rules from the environment, as the action passes them. */
export function fromEnv(env) {
  let labels = [];
  try {
    const parsed = JSON.parse(env.PR_LABELS || '[]');
    if (Array.isArray(parsed)) labels = parsed.map(String);
  } catch {
    // An unreadable label list is no labels: the check then asks for more,
    // the safe direction to be wrong in.
  }
  return {
    request: {
      files: (env.CHANGED_FILES ?? '').split('\n').map((f) => f.trim()).filter(Boolean),
      labels,
      author: env.PR_AUTHOR ?? '',
    },
    rules: {
      paths: list(env.CL_PATHS, DEFAULT_PATHS),
      ignore: list(env.CL_IGNORE, DEFAULT_IGNORE),
      changelog: env.CL_CHANGELOG?.trim() || DEFAULT_CHANGELOG,
      label: env.CL_LABEL?.trim() || DEFAULT_LABEL,
      exemptAuthors: list(env.CL_EXEMPT_AUTHORS, DEFAULT_EXEMPT_AUTHORS),
    },
  };
}

/** The lines to print and the exit code, for the pull request `env` describes. */
export function run(env) {
  const { request, rules } = fromEnv(env);
  const { problem, reason } = check(request, rules);
  // File names are author-chosen, so the message is escaped as workflow-command syntax requires.
  if (problem !== null) return { lines: [`::error::${escapeCommand(problem)}`], code: 1 };
  return { lines: [`Changelog check passed: ${reason}`], code: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href) {
  const { lines, code } = run(process.env);
  for (const line of lines) console.log(line);
  process.exitCode = code;
}
