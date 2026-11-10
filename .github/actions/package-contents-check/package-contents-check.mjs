#!/usr/bin/env node
/**
 * Whether the package ships each path that it must, and none that it must
 * not (#36).
 *
 *   node package-contents-check.mjs [--config .package-contents.json]
 *
 * A git-dependency install and an npm install get exactly what `npm pack`
 * makes, so this asks `npm pack --dry-run` for that list. A `files` entry
 * that drops a licence file, or that ships the tests, fails nothing else.
 *
 * The config:
 *
 *   { "required": ["LICENSE", "package.json", "src/index.ts"],
 *     "forbidden": ["\\.test\\.(m?js|ts)$", "^\\.github/"] }
 *
 * `required` are exact paths. `forbidden` are regular expressions, each
 * tested against each path that ships.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

/** The two lists, with each forbidden pattern compiled. Throws when the config has the wrong shape. */
export function parseConfig(text, file = '.package-contents.json') {
  const config = JSON.parse(text);
  const isStrings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
  if (!isStrings(config?.required) || !isStrings(config?.forbidden)) {
    throw new Error(`${file} must have "required" and "forbidden", each a list of strings`);
  }
  return { required: config.required, forbidden: config.forbidden.map((pattern) => new RegExp(pattern)) };
}

/** Each required path that does not ship, and each shipped path that a forbidden pattern matches. */
export function problems(shipped, { required, forbidden }) {
  const paths = new Set(shipped);
  return [
    ...required.filter((file) => !paths.has(file)).map((file) => `missing: ${file}`),
    ...shipped.filter((file) => forbidden.some((pattern) => pattern.test(file))).map((file) => `should not ship: ${file}`),
  ];
}

/** Checks the package in `cwd`, prints the result, and returns the exit code. */
export function run({ cwd = process.cwd(), config = '.package-contents.json' } = {}) {
  try {
    const rules = parseConfig(readFileSync(path.resolve(cwd, config), 'utf8'), config);
    const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd, encoding: 'utf8' }));
    const shipped = pack.files.map((file) => file.path);
    const found = problems(shipped, rules);
    for (const line of found) console.log(`::error title=Package contents::${pack.name}@${pack.version}: ${line}`);
    if (found.length > 0) return 1;
    console.log(`${pack.name}@${pack.version} ships ${shipped.length} files, with each required path and no forbidden one.`);
    return 0;
  } catch (error) {
    console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

// Importing this file (the test does) must not run npm.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href) {
  const { values } = parseArgs({ options: { config: { type: 'string', default: '.package-contents.json' } } });
  process.exitCode = run({ config: values.config });
}
