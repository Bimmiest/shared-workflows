#!/usr/bin/env node
/**
 * Whether a repository has the files that each repository made from its
 * forge's template has (#58). Each file of the list is present, or excepted in
 * `.baseline-exceptions.json` with the reason that this repository differs.
 *
 *   node baseline-check.mjs [--config .baseline-exceptions.json]
 *                           [--forge github|forgejo] [--stacks "<stack> …"]
 *
 * The lists are the core set and the stack layers of repo-template's
 * `docs/standard.md` (#67). They are in this file, not read from a template
 * when the check runs, so a pinned check checks the same files until its pin
 * moves. Thus a file added to a list is a major version, as for each check
 * that fails on something that it passed.
 *
 * With no stacks, the documentation layer applies, and the Node files apply
 * where there is a `package-lock.json`. That is the default, so a repository
 * that names no stack gets the same list from each minor version.
 *
 * An exception for a file that is present, or that is not on the list, fails,
 * so the exceptions cannot rot.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

/** The core set: the files that each repository keeps, on each forge. */
export const CORE = {
  github: [
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
    'docs/adr/README.md',
  ],
  // No LICENSE: the Forgejo repositories are private. Renovate replaces
  // Dependabot, and the forge settings are code in another repository, so
  // there is no settings.yml or .repo-settings.json.
  forgejo: [
    'README.md',
    'CONTRIBUTING.md',
    'CLAUDE.md',
    'SECURITY.md',
    'CHANGELOG.md',
    '.forgejo/CODEOWNERS',
    '.forgejo/pull_request_template.md',
    '.forgejo/ISSUE_TEMPLATE/bug.yml',
    '.forgejo/ISSUE_TEMPLATE/config.yml',
    '.forgejo/ISSUE_TEMPLATE/decision.yml',
    '.forgejo/ISSUE_TEMPLATE/enhancement.yml',
    '.forgejo/ISSUE_TEMPLATE/tech-debt.yml',
    '.forgejo/workflows/ci.yml',
    '.forgejo/workflows/pr-hygiene.yml',
    '.forgejo/workflows/security.yml',
    '.gitleaks.toml',
    '.trivyignore.yaml',
    '.docs-check.json',
    'renovate.json',
    'docs/adr/README.md',
  ],
};

/** The template that a missing file comes from, on each forge. */
const TEMPLATE = { github: 'repo-template', forgejo: 'pipelines/repo-template' };

/** The documentation layer, for the stacks with code (estate ADR 0021). */
export const DOCS = [
  'docs/README.md',
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

/**
 * The stacks of the standard. Only `node-ts` has files of its own. The rules
 * of the other layers are gates, which the repository's CI runs, so a stack
 * here only decides whether the documentation layer applies.
 */
export const STACKS = ['node-ts', 'rust', 'opentofu-ansible', 'container-image', 'gitops-config', 'docs-only'];
const CODE_STACKS = ['node-ts', 'rust', 'opentofu-ansible'];

/** Which layers apply. With no stacks, the default in the header above. */
export function layers(stacks, { lockfile }) {
  if (!stacks.length) return { docs: true, node: lockfile };
  return { docs: stacks.some((s) => CODE_STACKS.includes(s)), node: stacks.includes('node-ts') };
}

/** The baseline files for a repository on `forge`, with the layers that apply. */
export function baseline({ forge = 'github', docs = true, node = false } = {}) {
  return [...CORE[forge], ...(docs ? DOCS : []), ...(node ? NODE : [])];
}

/**
 * The lines to print and the exit code. `exists(file)` says whether a file is
 * in the repository, and `exceptions` is the list from the config file.
 */
export function check(exists, exceptions, { file = '.baseline-exceptions.json', forge = 'github', stacks = [] } = {}) {
  const bad = [
    ...(Object.hasOwn(CORE, forge) ? [] : [`::error::forge must be one of ${Object.keys(CORE).join(', ')}, not '${forge}'.`]),
    ...stacks.filter((s) => !STACKS.includes(s)).map((s) => `::error::'${s}' is not a stack. Use one or more of ${STACKS.join(', ')}.`),
  ];
  if (bad.length) return { lines: bad, code: 1 };
  const wanted = baseline({ forge, ...layers(stacks, { lockfile: exists('package-lock.json') }) });
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
      `::error::${name} is missing. Take it from ${TEMPLATE[forge]}, or add { "file": "${name}", "reason": "…" } to ${file}.`,
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

/**
 * The check of the repository at `root`, with the exceptions in `file`
 * (relative to `root`). `stacks` is a space-separated list.
 */
export function run(root, file = '.baseline-exceptions.json', { forge = 'github', stacks = '' } = {}) {
  try {
    return check((name) => existsSync(path.join(root, name)), readExceptions(path.join(root, file)), {
      file,
      forge,
      stacks: stacks.split(/\s+/).filter(Boolean),
    });
  } catch (error) {
    return { lines: [`::error file=${file}::${error instanceof Error ? error.message : String(error)}`], code: 1 };
  }
}

// Importing this file (the test does) must not read the working directory.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href) {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', default: '.baseline-exceptions.json' },
      forge: { type: 'string', default: 'github' },
      stacks: { type: 'string', default: '' },
    },
  });
  const { lines, code } = run('.', values.config, { forge: values.forge, stacks: values.stacks });
  for (const line of lines) console.log(line);
  process.exitCode = code;
}
