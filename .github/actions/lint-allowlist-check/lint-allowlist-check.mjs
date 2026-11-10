#!/usr/bin/env node
/**
 * Whether the lint allowlist still says what each rule finds (#38).
 *
 *   node lint-allowlist-check.mjs [--allowlist scripts/lint-allowlist.json]
 *
 * When a repository adopts a rule over existing code, it lists the findings of
 * that day by file and by rule, and its `eslint.config.js` turns each listed
 * rule off for its file:
 *
 *   { "files": { "src/index.ts": { "@typescript-eslint/no-non-null-assertion": 10 } } }
 *
 * The lint then cannot see a new finding in a listed file. This lints each
 * listed file with its listed rules on again, through the caller's own ESLint
 * and config, and fails when a count differs. A higher count is new code,
 * which gets no exception. A lower count is a fix, which lowers the number in
 * the same change, so the list only gets shorter.
 *
 * A rule is turned on again with a severity alone. ESLint keeps the options
 * that an earlier config gave, so a rule such as `no-restricted-syntax` keeps
 * its selectors.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export const DEFAULT_ALLOWLIST = 'scripts/lint-allowlist.json';

/** The files and their counts. Throws when the allowlist has the wrong shape. */
export function parseAllowlist(text, file = DEFAULT_ALLOWLIST) {
  const { files } = JSON.parse(text) ?? {};
  const shape = `${file} must have "files": { "<path>": { "<rule>": <count of 1 or more> } }`;
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error(shape);
  for (const rules of Object.values(files)) {
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) throw new Error(shape);
    if (!Object.values(rules).every((count) => Number.isInteger(count) && count > 0)) throw new Error(shape);
  }
  return files;
}

/** The path as a glob that matches only itself: `files` takes a glob, and `[id]` is a character class. */
export function literal(file) {
  return file.replace(/[[\]{}()*?!+@]/g, '\\$&');
}

/** One config block per file, with its listed rules on again. */
export function overrides(files) {
  return Object.entries(files).map(([file, rules]) => ({
    files: [literal(file)],
    rules: Object.fromEntries(Object.keys(rules).map((rule) => [rule, 'error'])),
  }));
}

/** Each listed rule whose count in `messages` is not the listed one, as a sentence. */
export function differences(file, rules, messages) {
  const found = Object.fromEntries(Object.keys(rules).map((rule) => [rule, 0]));
  for (const { ruleId } of messages) if (ruleId != null && ruleId in found) found[ruleId] += 1;
  const fatal = messages.filter((message) => message.fatal).map((message) => `${file} could not be linted: ${message.message}`);
  return [
    ...fatal,
    ...Object.entries(rules)
      .filter(([rule, count]) => found[rule] !== count)
      .map(([rule, count]) =>
        found[rule] > count
          ? `${file}: ${rule} finds ${found[rule]}, and the allowlist says ${count}. Fix the new finding: a listed file gets no new exception.`
          : `${file}: ${rule} finds ${found[rule]}, and the allowlist says ${count}. Lower the count in the allowlist, in this change.`,
      ),
  ];
}

/** Each problem with the allowlist in `cwd`, linted with `ESLint`. */
export async function check({ ESLint, cwd, files }) {
  const missing = Object.keys(files).filter((file) => !existsSync(path.resolve(cwd, file)));
  const present = Object.keys(files).filter((file) => !missing.includes(file));
  const problems = missing.map((file) => `${file} is in the allowlist and does not exist. Take it off the list.`);
  if (present.length === 0) return problems;
  const normal = (file) => path.relative(cwd, path.resolve(cwd, file)).split(path.sep).join('/');
  const eslint = new ESLint({ cwd, overrideConfig: overrides(Object.fromEntries(present.map((file) => [normal(file), files[file]]))) });
  // By absolute path, so that `./src/a.ts` in the list still finds its result.
  const listed = new Map(present.map((file) => [path.resolve(cwd, file), file]));
  for (const result of await eslint.lintFiles(present)) {
    const file = listed.get(result.filePath);
    if (file === undefined) problems.push(`ESLint linted ${result.filePath}, which is not in the allowlist.`);
    else problems.push(...differences(file, files[file], result.messages));
  }
  return problems;
}

/** The `ESLint` class that the project in `cwd` installs. This repository has no dependency of its own. */
export function projectEslint(cwd) {
  try {
    return createRequire(path.join(cwd, 'package.json'))('eslint').ESLint;
  } catch {
    throw new Error(`No eslint is installed in ${cwd}. Run the check after npm ci.`);
  }
}

/** Checks the allowlist in `cwd`, prints the result, and returns the exit code. */
export async function run({ cwd = process.cwd(), allowlist = DEFAULT_ALLOWLIST, loadEslint = projectEslint } = {}) {
  try {
    const files = parseAllowlist(readFileSync(path.resolve(cwd, allowlist), 'utf8'), allowlist);
    const problems = await check({ ESLint: loadEslint(cwd), cwd, files });
    for (const line of problems) console.log(`::error title=Lint allowlist::${line}`);
    if (problems.length > 0) return 1;
    const total = Object.values(files).reduce((sum, rules) => sum + Object.values(rules).reduce((a, b) => a + b, 0), 0);
    console.log(`The allowlist holds ${total} findings in ${Object.keys(files).length} files, and each count is what its rule finds.`);
    return 0;
  } catch (error) {
    console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

// Importing this file (the test does) must not lint anything.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href) {
  const { values } = parseArgs({ options: { allowlist: { type: 'string', default: DEFAULT_ALLOWLIST } } });
  process.exitCode = await run({ allowlist: values.allowlist });
}
