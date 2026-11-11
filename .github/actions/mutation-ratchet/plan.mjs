#!/usr/bin/env node
/**
 * The files that each job of the reusable workflow `mutation.yml` mutates
 * (#37), as the outputs of its `plan` job.
 *
 *   node plan.mjs [--config stryker.config.mjs] [--shards 1] [--base origin/main]
 *                 [--artifact-name mutation-report] [--output file] [--summary file]
 *
 * With --base, it is the run of a pull request (repo-template ADR 0004): the
 * files in the `mutate` list of the config that the pull request adds or
 * changes, and the files in the list that a changed test file imports. A
 * change to a test can make it weaker, and only the full run would see that
 * otherwise. The scope is the config's own `mutate` list, so it is written in
 * one place.
 *
 * Without --base, it is the full run. With one shard, the job runs the
 * command with no --mutate, so Stryker reads its own list. With more, the
 * tracked files that the list selects are divided across the shards by size,
 * because GitHub stops a job after 6 hours (Bimmiest/propslab#851: 254 minutes
 * as one job, 42 minutes in four shards).
 *
 * The outputs are `mode` (`changed` or `full`), `run` (`true` when there is a
 * file to mutate) and `matrix`, a JSON list with one entry for each job:
 * `{ name, shard, of, files, artifact }`. `files` is the value for --mutate.
 *
 * This script is not a part of the `mutation-ratchet` action. It is here so
 * that `npm test` and the coverage floor reach it, as each script here is
 * under `.github/actions/`.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { readMutate, shardArtifact } from './stryker.mjs';

/**
 * Why the scripts cannot read `glob` as Stryker does, or null when they can.
 * Stryker reads a glob with minimatch. The scripts read `**`, `*` and a `!`
 * at the start, and refuse the other forms rather than select different files.
 */
export function unsupportedGlob(glob) {
  if (/[?[\]{}()]/.test(glob.replace(/^!/, ''))) return 'it has ?, [ ], { } or ( ), and the scripts read only ** and *';
  if (/:\d/.test(glob)) return 'it has a line range, and the scripts read only file names';
  if (glob.slice(1).includes('!')) return 'it has a ! after the start';
  return null;
}

/**
 * A glob of Stryker's `mutate` list as a regular expression: `**` spans
 * directories, `*` stays in one, and `**\/` also matches no directory.
 */
export function globRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob.charAt(i);
    if (glob.startsWith('**/', i)) {
      out += '(?:.*/)?';
      i += 2;
    } else if (glob.startsWith('**', i)) {
      out += '.*';
      i += 1;
    } else if (c === '*') {
      out += '[^/]*';
    } else {
      out += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * The files of `files` that `globs` select, in their order: matched by a
 * glob, and by no glob that starts with `!`.
 */
export function selectMutated(files, globs) {
  const include = globs.filter((g) => !g.startsWith('!')).map(globRegExp);
  const exclude = globs.filter((g) => g.startsWith('!')).map((g) => globRegExp(g.slice(1)));
  return files.filter((f) => include.some((re) => re.test(f)) && !exclude.some((re) => re.test(f)));
}

/** Whether `file` is a test, or is in a `__tests__` directory. */
export function isTestFile(file) {
  return /(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
}

// `import{a as b}from"./x.js"`, `import "./x"`, `export * from './x'`, and a
// list of names over several lines. `import("./x")` has a parenthesis before
// the string, so it does not match.
const STATIC_IMPORT = /\b(?:import|export)\s*(?:[^"'();]*?\bfrom\s*)?["']([^"']+)["']/g;

/**
 * The relative and root specifiers that `source` imports statically. A
 * package name is not a file of the repository, so it is not returned.
 */
export function staticImports(source) {
  return [...source.matchAll(STATIC_IMPORT)].map(([, spec]) => spec).filter((s) => s.startsWith('.') || s.startsWith('/'));
}

/** The path that `spec`, imported from `file`, names. A leading `/` is the root of the project. */
export function resolveImport(file, spec) {
  return spec.startsWith('/') ? path.posix.normalize(spec.slice(1)) : path.posix.join(path.posix.dirname(file), spec);
}

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * The source files that `testFile` imports, each resolved to a file that
 * exists: the name as written, the TypeScript file of a `.js` name, the name
 * with each extension, and the `index` file of a directory.
 */
export function importedSources(testFile, source, exists) {
  const found = [];
  for (const spec of staticImports(source)) {
    const base = resolveImport(testFile, spec);
    const typescript = base.replace(/\.([cm]?)js(x?)$/, '.$1ts$2');
    const candidates = [base, typescript, ...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => `${base}/index${e}`)];
    const file = candidates.find((p) => SOURCE.test(p) && exists(p));
    if (file !== undefined) found.push(file);
  }
  return found;
}

/**
 * `files` divided into `count` shards of about the same cost: the largest
 * file first, each to the shard with the lowest cost so far, and on a tie to
 * the lower shard. The cost of a file is its size, because a larger file has
 * more mutants. The same files give the same shards, so a rerun of one shard
 * mutates the same files.
 */
export function assignShards(files, count) {
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`The shard count must be a positive integer, not ${count}.`);
  const shards = Array.from({ length: count }, () => ({ cost: 0, paths: [] }));
  const ordered = [...files].sort((a, b) => b.size - a.size || (a.path < b.path ? -1 : 1));
  for (const file of ordered) {
    const lightest = shards.reduce((min, shard) => (shard.cost < min.cost ? shard : min));
    lightest.cost += file.size;
    lightest.paths.push(file.path);
  }
  return shards.map((shard) => shard.paths.sort());
}

const code = (list) => list.map((f) => `\`${f}\``).join(', ');

/** The globs of `config`, or the errors that say why the scripts cannot read them. */
function globsOf(io, config) {
  let text;
  try {
    text = io.read(config);
  } catch (error) {
    return { errors: [`::error file=${config}::Cannot read the Stryker config ${config}: ${error.message}. Give its path with stryker-config.`] };
  }
  let globs;
  try {
    globs = readMutate(text, config);
  } catch (error) {
    return { errors: [`::error file=${config}::${error.message}.`] };
  }
  const errors = globs.flatMap((glob) => {
    const why = unsupportedGlob(glob);
    return why ? [`::error file=${config}::The \`mutate\` glob "${glob}" cannot be read: ${why}. Write it with ** and * only, or list the files.`] : [];
  });
  return { globs, errors };
}

/** The plan of a pull request: the changed files in scope, and the files in scope that its changed tests import. */
function changedPlan(io, { config, base, artifactName }) {
  const { globs, errors } = globsOf(io, config);
  if (errors.length > 0) return { lines: errors, code: 1 };
  let diff;
  try {
    diff = io.git(['diff', '--name-only', '--no-renames', '--diff-filter=AM', '--relative', `${base}...HEAD`]);
  } catch (error) {
    return {
      lines: [`::error::git diff against ${base} failed: ${error.message.split('\n')[0]}. The checkout needs the history to the merge base: fetch-depth 0.`],
      code: 1,
    };
  }
  // Renames are off, so a file that moved and changed is an added file here,
  // not a status that the filter drops.
  const files = diff.split('\n').filter(Boolean);
  const changed = selectMutated(files, globs);
  const imported = files.filter((f) => isTestFile(f) && io.exists(f)).flatMap((f) => importedSources(f, io.read(f), io.exists));
  const tested = selectMutated([...new Set(imported)], globs).filter((f) => !changed.includes(f));
  const all = [...changed, ...tested];
  const summary = [];
  if (changed.length > 0) summary.push(`Mutating the ${changed.length} changed files in the \`mutate\` list: ${code(changed)}.`);
  if (tested.length > 0) summary.push(`Mutating the ${tested.length} files in the \`mutate\` list that the changed tests import: ${code(tested)}.`);
  if (all.length === 0) summary.push(`No file in the \`mutate\` list of \`${config}\` changed, and no changed test imports one. The full run mutates the rest.`);
  // One entry even when there is no file: GitHub fails a matrix with no
  // entry before it reads the `if` of the job, and `run` skips the job.
  const matrix = [{ name: 'changed files', shard: 0, of: 0, files: all.join(','), artifact: artifactName }];
  return { outputs: { mode: 'changed', run: String(all.length > 0), matrix: JSON.stringify(matrix) }, summary, lines: [], code: 0 };
}

/** The plan of the full run: one job with Stryker's own list, or the tracked files in scope in `shards` shards. */
function fullPlan(io, { config, shards, artifactName }) {
  if (shards === 1) {
    const matrix = [{ name: 'full run', shard: 1, of: 1, files: '', artifact: shardArtifact(artifactName, 1, 1) }];
    return { outputs: { mode: 'full', run: 'true', matrix: JSON.stringify(matrix) }, summary: ['The full run mutates the `mutate` list in one job.'], lines: [], code: 0 };
  }
  const { globs, errors } = globsOf(io, config);
  if (errors.length > 0) return { lines: errors, code: 1 };
  let tracked;
  try {
    tracked = io.git(['ls-files']).split('\n').filter(Boolean);
  } catch (error) {
    return { lines: [`::error::git ls-files failed: ${error.message.split('\n')[0]}. Run the plan in a git checkout.`], code: 1 };
  }
  const files = selectMutated(tracked, globs).map((f) => ({ path: f, size: io.size(f) }));
  const assigned = assignShards(files, shards);
  const empty = assigned.findIndex((paths) => paths.length === 0);
  // An empty --mutate would make Stryker mutate its whole list in that shard.
  if (empty !== -1) {
    return {
      lines: [`::error::Shard ${empty + 1} of ${shards} has no files: the \`mutate\` list of ${config} selects ${files.length} tracked files. Set shards to ${Math.max(1, files.length)} or fewer.`],
      code: 1,
    };
  }
  const matrix = assigned.map((paths, i) => ({
    name: `shard ${i + 1} of ${shards}`,
    shard: i + 1,
    of: shards,
    files: paths.join(','),
    artifact: shardArtifact(artifactName, i + 1, shards),
  }));
  const sizes = assigned.map((paths, i) => `| ${i + 1} of ${shards} | ${paths.length} | ${paths.reduce((sum, f) => sum + io.size(f), 0)} |`);
  return {
    outputs: { mode: 'full', run: 'true', matrix: JSON.stringify(matrix) },
    summary: [`The full run mutates ${files.length} files in ${shards} shards.`, '', '| Shard | Files | Bytes |', '|---|---|---|', ...sizes],
    lines: [],
    code: 0,
  };
}

/**
 * The plan for the options, with git and the files reached through `io`:
 * `{ read(file), exists(file), size(file), git(args) }`, each relative to the
 * project. Returns `{ outputs, summary, lines, code }`.
 */
export function plan(io, { config = 'stryker.config.mjs', shards = 1, base = '', artifactName = 'mutation-report' } = {}) {
  if (!Number.isInteger(shards) || shards < 1) return { lines: [`::error::shards is "${shards}". Set it to a whole number, 1 or more.`], code: 1 };
  if (!/^[\w.-]+$/.test(artifactName)) {
    return { lines: [`::error::artifact-name is "${artifactName}". Use letters, digits, ".", "_" and "-" only.`], code: 1 };
  }
  return base ? changedPlan(io, { config, base, artifactName }) : fullPlan(io, { config, shards, artifactName });
}

/** The `io` of `plan` on the files and the git repository in `cwd`. */
export function fileSystem(cwd = '.') {
  const at = (file) => path.join(cwd, file);
  return {
    read: (file) => readFileSync(at(file), 'utf8'),
    exists: (file) => {
      try {
        return statSync(at(file)).isFile();
      } catch {
        return false;
      }
    },
    size: (file) => statSync(at(file)).size,
    git: (args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }),
  };
}

/** Runs `plan` with the command-line `argv`, and writes its outputs and summary. Returns the exit code. */
export function main(argv, cwd = '.') {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: 'string', default: 'stryker.config.mjs' },
      shards: { type: 'string', default: '1' },
      base: { type: 'string', default: '' },
      'artifact-name': { type: 'string', default: 'mutation-report' },
      output: { type: 'string' },
      summary: { type: 'string' },
    },
  });
  const shards = /^\d+$/.test(values.shards) ? Number(values.shards) : values.shards;
  const result = plan(fileSystem(cwd), { config: values.config, shards, base: values.base, artifactName: values['artifact-name'] });
  for (const line of result.lines) console.log(line);
  const outputs = Object.entries(result.outputs ?? {}).map(([key, value]) => `${key}=${value}\n`).join('');
  const summary = (result.summary ?? []).map((line) => `${line}\n`).join('');
  if (values.output) appendFileSync(values.output, outputs);
  else process.stdout.write(outputs);
  if (values.summary) appendFileSync(values.summary, summary);
  else process.stdout.write(summary);
  return result.code;
}

// Importing this file (the test does) must not read the working directory.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href) {
  process.exitCode = main(process.argv.slice(2));
}
