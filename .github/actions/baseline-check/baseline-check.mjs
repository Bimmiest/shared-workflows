#!/usr/bin/env node
/**
 * Whether a repository has the files that each repository made from
 * repo-template has (#58). Each file of the list is present, or excepted in
 * `.baseline-exceptions.json` with the reason that this repository differs.
 *
 *   node baseline-check.mjs [--config .baseline-exceptions.json]
 *
 * The list is in this file, not read from repo-template when the check runs,
 * so a pinned check checks the same files until its pin moves. Thus a file
 * added to the list is a major version, as for each check that fails on
 * something that it passed. The Node files apply only where there is a
 * `package-lock.json`.
 *
 * An exception for a file that is present, or that is not on the list, fails,
 * so the exceptions cannot rot.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

/** The files of repo-template that each repository keeps. */
export const CORE = [
  'README.md',
  'CONTRIBUTING.md',
  'CLAUDE.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'CHANGELOG.md',
  'LICENSE',
  '.github/CODEOWNERS',
  '.github/dependabot.yml',
  '.github/pull_request_template.md',
  '.github/ISSUE_TEMPLATE/bug.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/ISSUE_TEMPLATE/decision.yml',
  '.github/ISSUE_TEMPLATE/enhancement.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/pr-hygiene.yml',
  '.github/workflows/scorecard.yml',
  '.github/workflows/security.yml',
  '.github/workflows/settings.yml',
  '.github/workflows/supply-chain.yml',
  '.gitleaks.toml',
  '.trivyignore.yaml',
  '.repo-settings.json',
  '.docs-check.json',
  '.git-blame-ignore-revs',
  'docs/README.md',
  'docs/adr/README.md',
  'docs/ci.md',
  'docs/code-style.md',
  'docs/dependencies.md',
  'docs/development.md',
  'docs/documentation.md',
  'docs/testing.md',
];

/** The files of repo-template's Node toolchain, for a repository with a `package-lock.json`. */
export const NODE = [
  '.audit-exceptions.json',
  '.licence-allowlist.json',
  '.nvmrc',
  '.npmrc',
  'package.json',
  '.prettierrc.json',
  '.prettierignore',
  'eslint.config.js',
  'vitest.config.ts',
  'scripts/eslint-comments.mjs',
];

/** The baseline files for a repository, given whether it has a Node toolchain. */
export function baseline({ node }) {
  return node ? [...CORE, ...NODE] : CORE;
}

/**
 * The lines to print and the exit code. `exists(file)` says whether a file is
 * in the repository, and `exceptions` is the list from the config file.
 */
export function check(exists, exceptions, { file = '.baseline-exceptions.json' } = {}) {
  const wanted = baseline({ node: exists('package-lock.json') });
  const errors = [];
  const excepted = new Set();
  for (const entry of exceptions) {
    const name = entry?.file;
    if (typeof name !== 'string' || typeof entry.reason !== 'string' || !entry.reason.trim()) {
      errors.push(`::error file=${file}::Each exception needs a \`file\` and a \`reason\`: ${JSON.stringify(entry)}`);
    } else if (!wanted.includes(name)) {
      errors.push(`::error file=${file}::${name} is not a baseline file of this repository. Remove its exception.`);
    } else if (exists(name)) {
      errors.push(`::error file=${file}::${name} exists. Remove its exception.`);
    } else {
      excepted.add(name);
    }
  }
  const missing = wanted.filter((name) => !exists(name) && !excepted.has(name));
  for (const name of missing) {
    errors.push(
      `::error::${name} is missing. Take it from repo-template, or add { "file": "${name}", "reason": "…" } to ${file}.`,
    );
  }
  if (errors.length) return { lines: errors, code: 1 };
  const present = wanted.length - excepted.size;
  return {
    lines: [
      `${present} baseline files are present${excepted.size ? `, and ${excepted.size} ${excepted.size === 1 ? 'is' : 'are'} excepted in ${file}` : ''}.`,
    ],
    code: 0,
  };
}

/** The exceptions in `file`, or none when there is no file. */
export function readExceptions(file) {
  if (!existsSync(file)) return [];
  const config = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(config.exceptions)) throw new Error(`${file} must have an "exceptions" list`);
  return config.exceptions;
}

/** The check of the repository at `root`, with the exceptions in `file` (relative to `root`). */
export function run(root, file = '.baseline-exceptions.json') {
  try {
    return check((name) => existsSync(path.join(root, name)), readExceptions(path.join(root, file)), { file });
  } catch (error) {
    return { lines: [`::error file=${file}::${error instanceof Error ? error.message : String(error)}`], code: 1 };
  }
}

// Importing this file (the test does) must not read the working directory.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href) {
  const { values } = parseArgs({ options: { config: { type: 'string', default: '.baseline-exceptions.json' } } });
  const { lines, code } = run('.', values.config);
  for (const line of lines) console.log(line);
  process.exitCode = code;
}
