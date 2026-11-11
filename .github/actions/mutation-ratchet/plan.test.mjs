import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assignShards,
  fileSystem,
  globRegExp,
  importedSources,
  isTestFile,
  main,
  plan,
  resolveImport,
  selectMutated,
  staticImports,
  unsupportedGlob,
} from './plan.mjs';

/** propslab's `mutate` list as of #851, which `selectMutated` came from. */
const PROPSLAB_GLOBS = [
  'src/engine/**/*.ts',
  'src/utils/strftime.ts',
  'src/utils/splunkRegex.ts',
  'packages/mcp-server/src/requestId.ts',
  'src/workers/workerLifecycle.ts',
  'src/store/**/*.ts',
  'src/monaco/*.ts',
  '!src/store/**/__tests__/**',
  '!src/engine/**/__tests__/**',
  '!src/engine/**/*.test.ts',
  '!src/engine/types.ts',
  '!src/engine/*Worker.ts',
  '!src/engine/registry/**',
  '!src/engine/directiveSupport.ts',
];

describe('unsupportedGlob', () => {
  it('accepts ** and *, and a ! at the start', () => {
    for (const glob of PROPSLAB_GLOBS) assert.equal(unsupportedGlob(glob), null, glob);
  });

  it('refuses the minimatch forms that it does not read, and a line range', () => {
    assert.match(unsupportedGlob('src/**/*.{ts,tsx}'), /\{ \}/);
    assert.match(unsupportedGlob('src/?.ts'), /\?/);
    assert.match(unsupportedGlob('!src/[ab].ts'), /\[ \]/);
    assert.match(unsupportedGlob('src/!(x).ts'), /\( \)/);
    assert.match(unsupportedGlob('src/a.ts:1-10'), /line range/);
    assert.match(unsupportedGlob('src/!x.ts'), /! after the start/);
  });
});

describe('selectMutated', () => {
  it("keeps what Stryker's mutate globs select, and drops what they exclude", () => {
    assert.deepEqual(
      selectMutated(
        [
          'src/engine/pipeline.ts',
          'src/engine/processors/lineBreaker.ts',
          'src/utils/splunkRegex.ts',
          'src/store/useAppStore.ts',
          'src/engine/types.ts',
          'src/engine/pipelineWorker.ts',
          'src/engine/registry/propsDirectives.ts',
          'src/engine/directiveSupport.ts',
          'src/engine/__tests__/lineBreaker.test.ts',
          'src/utils/regexSyntax.ts',
          'packages/mcp-server/src/runInWorker.ts',
          'docs/engine.md',
        ],
        PROPSLAB_GLOBS,
      ),
      ['src/engine/pipeline.ts', 'src/engine/processors/lineBreaker.ts', 'src/utils/splunkRegex.ts', 'src/store/useAppStore.ts'],
    );
  });

  it('reads `**/` as zero or more directories and `*` as one name', () => {
    assert.deepEqual(selectMutated(['a/b.ts', 'a/x/y/b.ts', 'a/b/c.ts'], ['a/**/b.ts']), ['a/b.ts', 'a/x/y/b.ts']);
    assert.deepEqual(selectMutated(['a/b.ts', 'a/x/b.ts'], ['a/*.ts']), ['a/b.ts']);
    assert.deepEqual(selectMutated(['a.ts', 'a+ts'], ['a.ts']), ['a.ts']);
  });

  it('reads `**` at the end as any depth, and a list with no glob as nothing', () => {
    assert.deepEqual(selectMutated(['a/b', 'a/b/c.ts', 'ab'], ['a/**']), ['a/b', 'a/b/c.ts']);
    assert.deepEqual(selectMutated(['a.ts'], []), []);
    assert.equal(globRegExp('a/**/*.ts').source, '^a\\/(?:.*\\/)?[^/]*\\.ts$');
  });
});

describe('isTestFile', () => {
  it('is true for tests, specs and their support files', () => {
    for (const file of ['src/engine/__tests__/runCtx.ts', '__tests__/a.ts', 'src/a.test.ts', 'src/X.test.tsx', 'src/a.spec.mjs', 'src/a.test.cjs']) {
      assert.equal(isTestFile(file), true, file);
    }
  });

  it('is false for a source file', () => {
    for (const file of ['src/engine/pipeline.ts', 'src/test/gc.ts', 'src/contest.ts']) assert.equal(isTestFile(file), false, file);
  });
});

describe('staticImports', () => {
  it('reads the static forms, minified or not, over several lines', () => {
    const source = 'import{a as b}from"./x.js";import"./side.js";export{c}from"./y.js";export*from"./z.js";import d from"./d.js";';
    assert.deepEqual(staticImports(source), ['./x.js', './side.js', './y.js', './z.js', './d.js']);
    assert.deepEqual(staticImports("import {\n  a,\n  type B,\n} from './index.ts';\nexport * from '../up';"), ['./index.ts', '../up']);
  });

  it('does not follow a dynamic import(), or a package', () => {
    assert.deepEqual(staticImports('const m = () => import("./lazy.js"); import fc from "fast-check"; import x from "/root.js"'), ['/root.js']);
  });
});

describe('resolveImport', () => {
  it('resolves against the importing file, and a leading slash against the root', () => {
    assert.equal(resolveImport('src/sub/x.test.ts', '../y'), 'src/y');
    assert.equal(resolveImport('src/x.test.ts', './y.js'), 'src/y.js');
    assert.equal(resolveImport('src/x.test.ts', '/lib/z'), 'lib/z');
  });
});

describe('importedSources', () => {
  it('resolves relative imports to the files that exist, with or without an index', () => {
    const exists = (p) => ['src/engine/pipeline.ts', 'src/engine/processors/lineBreaker.ts', 'src/engine/utils/index.ts'].includes(p);
    const source = [
      "import { describe } from 'vitest';",
      "import { runPipeline } from '../pipeline';",
      "import { breakLines } from '../processors/lineBreaker';",
      "import { x } from '../utils';",
      "import { gone } from '../missing';",
    ].join('\n');
    assert.deepEqual(importedSources('src/engine/__tests__/a.test.ts', source, exists), [
      'src/engine/pipeline.ts',
      'src/engine/processors/lineBreaker.ts',
      'src/engine/utils/index.ts',
    ]);
  });

  it('reads an explicit extension, the TypeScript file of a .js name, and a JavaScript file', () => {
    const exists = (p) => ['src/index.ts', 'src/a.mts', 'src/b.js', 'src/c.tsx'].includes(p);
    const source = "import './index.ts'; import './a.mjs'; import './b'; import './c.jsx'; import './data.json';";
    assert.deepEqual(importedSources('src/x.test.ts', source, exists), ['src/index.ts', 'src/a.mts', 'src/b.js', 'src/c.tsx']);
  });
});

describe('assignShards', () => {
  const files = [
    { path: 'a.ts', size: 50 },
    { path: 'b.ts', size: 40 },
    { path: 'c.ts', size: 30 },
    { path: 'd.ts', size: 20 },
    { path: 'e.ts', size: 10 },
    { path: 'f.ts', size: 10 },
  ];

  it('gives each file to exactly one shard', () => {
    assert.deepEqual(assignShards(files, 3).flat().sort(), files.map((f) => f.path));
  });

  it('puts the largest file first into the shard with the lowest cost so far', () => {
    // a(50) to 1, b(40) to 2, c(30) to 2 (40 < 50), d(20) to 1 (50 < 70),
    // e(10) to 1 (a tie at 70), f(10) to 2 (70 < 80).
    assert.deepEqual(assignShards(files, 2), [
      ['a.ts', 'd.ts', 'e.ts'],
      ['b.ts', 'c.ts', 'f.ts'],
    ]);
  });

  it('gives the same shards whatever the order of the input', () => {
    assert.deepEqual(assignShards([...files].reverse(), 3), assignShards(files, 3));
  });

  it('breaks a tie of size by path, and a tie of cost by the lower shard', () => {
    assert.deepEqual(
      assignShards(
        [
          { path: 'y.ts', size: 5 },
          { path: 'x.ts', size: 5 },
        ],
        2,
      ),
      [['x.ts'], ['y.ts']],
    );
  });

  it('leaves a shard empty when there are fewer files than shards', () => {
    assert.deepEqual(assignShards([{ path: 'a.ts', size: 1 }], 2), [['a.ts'], []]);
  });

  it('refuses a count that is not a positive integer', () => {
    assert.throws(() => assignShards(files, 0), /positive integer, not 0/);
    assert.throws(() => assignShards(files, 1.5), RangeError);
  });
});

/** An `io` for `plan` over the text of each file, and the answers of git. */
function fakeIo(files, git = {}) {
  return {
    read: (file) => {
      if (!(file in files)) throw new Error(`ENOENT: no such file, open '${file}'`);
      return files[file];
    },
    exists: (file) => file in files,
    size: (file) => files[file].length,
    git: (args) => {
      const answer = git[args[0]];
      if (answer instanceof Error) throw answer;
      return answer ?? '';
    },
  };
}

const CONFIG = "export default { mutate: ['src/**/*.ts', '!src/**/*.test.ts'], thresholds: { break: 80 } };";

describe('plan, for a pull request', () => {
  it('mutates the changed files in scope, and the files in scope that a changed test imports, once each', () => {
    const io = fakeIo(
      {
        'stryker.config.mjs': CONFIG,
        'src/a.ts': 'a',
        'src/b.ts': 'b',
        'src/c.ts': 'c',
        'src/b.test.ts': "import { b } from './b'; import { c } from './c'; import { a } from './a';",
      },
      { diff: 'src/a.ts\nsrc/b.test.ts\ndocs/x.md\n' },
    );
    const result = plan(io, { base: 'origin/main' });
    assert.equal(result.code, 0);
    assert.deepEqual(result.outputs, {
      mode: 'changed',
      run: 'true',
      matrix: JSON.stringify([{ name: 'changed files', shard: 0, of: 0, files: 'src/a.ts,src/b.ts,src/c.ts', artifact: 'mutation-report' }]),
    });
    assert.match(result.summary[0], /the 1 changed files in the `mutate` list: `src\/a\.ts`/);
    assert.match(result.summary[1], /the 2 files in the `mutate` list that the changed tests import: `src\/b\.ts`, `src\/c\.ts`/);
  });

  it('runs nothing, and says so, when nothing in scope changed', () => {
    const result = plan(fakeIo({ 'stryker.config.mjs': CONFIG }, { diff: 'README.md\nsrc/gone.test.ts\n' }), { base: 'origin/main' });
    assert.equal(result.code, 0);
    assert.deepEqual(result.outputs, {
      mode: 'changed',
      run: 'false',
      matrix: JSON.stringify([{ name: 'changed files', shard: 0, of: 0, files: '', artifact: 'mutation-report' }]),
    });
    assert.match(result.summary[0], /No file in the `mutate` list of `stryker\.config\.mjs` changed/);
  });

  it('fails with the cause when git cannot diff against the base', () => {
    const result = plan(fakeIo({ 'stryker.config.mjs': CONFIG }, { diff: new Error('fatal: bad revision\nmore') }), { base: 'origin/main' });
    assert.equal(result.code, 1);
    assert.deepEqual(result.lines, ['::error::git diff against origin/main failed: fatal: bad revision. The checkout needs the history to the merge base: fetch-depth 0.']);
  });

  it('fails when the config is missing, has no literal list, or has a glob that it cannot read', () => {
    assert.match(plan(fakeIo({}), { base: 'b', config: 'x.mjs' }).lines[0], /^::error file=x\.mjs::Cannot read the Stryker config x\.mjs: ENOENT/);
    assert.match(plan(fakeIo({ 'stryker.config.mjs': 'export default {}' }), { base: 'b' }).lines[0], /has no `mutate`\.$/);
    const braces = plan(fakeIo({ 'stryker.config.mjs': "x = { mutate: ['src/*.{ts,js}', 'src/?.ts'] }" }), { base: 'b' });
    assert.equal(braces.code, 1);
    assert.equal(braces.lines.length, 2);
    assert.match(braces.lines[0], /The `mutate` glob "src\/\*\.\{ts,js\}" cannot be read/);
  });
});

describe('plan, for the full run', () => {
  it('runs Stryker on its own list in one job, with no config read, for one shard', () => {
    const result = plan(fakeIo({}), { shards: 1, artifactName: 'm' });
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.outputs.matrix), [{ name: 'full run', shard: 1, of: 1, files: '', artifact: 'm-1-of-1' }]);
  });

  it('divides the tracked files in scope across the shards by size', () => {
    const io = fakeIo(
      { 'stryker.config.mjs': CONFIG, 'src/a.ts': 'aaaa', 'src/b.ts': 'bbb', 'src/c.ts': 'cc', 'src/a.test.ts': 't' },
      { 'ls-files': 'stryker.config.mjs\nsrc/a.ts\nsrc/a.test.ts\nsrc/b.ts\nsrc/c.ts\n' },
    );
    const result = plan(io, { shards: 2 });
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.outputs.matrix), [
      { name: 'shard 1 of 2', shard: 1, of: 2, files: 'src/a.ts', artifact: 'mutation-report-1-of-2' },
      { name: 'shard 2 of 2', shard: 2, of: 2, files: 'src/b.ts,src/c.ts', artifact: 'mutation-report-2-of-2' },
    ]);
    assert.equal(result.summary[0], 'The full run mutates 3 files in 2 shards.');
    assert.deepEqual(result.summary.slice(-2), ['| 1 of 2 | 1 | 4 |', '| 2 of 2 | 2 | 5 |']);
  });

  it('fails when a shard would have no files, and when the config cannot be read', () => {
    const io = fakeIo({ 'stryker.config.mjs': CONFIG, 'src/a.ts': 'a' }, { 'ls-files': 'src/a.ts\n' });
    assert.deepEqual(plan(io, { shards: 3 }).lines, [
      '::error::Shard 2 of 3 has no files: the `mutate` list of stryker.config.mjs selects 1 tracked files. Set shards to 1 or fewer.',
    ]);
    assert.equal(plan(fakeIo({}), { shards: 2 }).code, 1);
  });

  it('fails with the cause when git cannot list the tracked files', () => {
    const io = fakeIo({ 'stryker.config.mjs': CONFIG }, { 'ls-files': new Error('fatal: not a git repository') });
    assert.deepEqual(plan(io, { shards: 2 }).lines, ['::error::git ls-files failed: fatal: not a git repository. Run the plan in a git checkout.']);
  });
});

describe('plan, its options', () => {
  it('refuses a shard count that is not a whole number of 1 or more, and an artifact name with other characters', () => {
    assert.match(plan(fakeIo({}), { shards: 0 }).lines[0], /shards is "0"/);
    assert.match(plan(fakeIo({}), { shards: 'two' }).lines[0], /shards is "two"/);
    assert.match(plan(fakeIo({}), { artifactName: 'a/b' }).lines[0], /artifact-name is "a\/b"/);
  });
});

const scratch = mkdtempSync(path.join(tmpdir(), 'mutation-plan-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** A git repository in `dir`, with `files` committed on main, then `changes` committed on a branch. */
function repository(dir, files, changes) {
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir, stdio: 'pipe' });
  const write = (entries) => {
    for (const [file, text] of Object.entries(entries)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), text);
    }
  };
  mkdirSync(dir, { recursive: true });
  git('init', '-q', '-b', 'main');
  write(files);
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'change');
  write(changes);
  git('add', '.');
  git('commit', '-q', '-m', 'change');
}

describe('main, on a git repository', () => {
  const dir = path.join(scratch, 'repo');
  repository(
    dir,
    { 'project/stryker.config.mjs': CONFIG, 'project/src/a.ts': 'export const a = 1;\n', 'project/src/b.ts': 'export const b = 2;\n', 'other/src/z.ts': 'z' },
    { 'project/src/a.ts': 'export const a = 3;\n', 'project/src/b.test.ts': "import { b } from './b.js';\n", 'other/src/z.ts': 'y' },
  );
  const project = path.join(dir, 'project');

  it('writes the outputs and the summary of a pull request to their files, with paths from the working directory', () => {
    const output = path.join(scratch, 'output');
    const summary = path.join(scratch, 'summary');
    assert.equal(main(['--base', 'main', '--output', output, '--summary', summary, '--artifact-name', 'm'], project), 0);
    assert.equal(
      readFileSync(output, 'utf8'),
      `mode=changed\nrun=true\nmatrix=${JSON.stringify([{ name: 'changed files', shard: 0, of: 0, files: 'src/a.ts,src/b.ts', artifact: 'm' }])}\n`,
    );
    assert.match(readFileSync(summary, 'utf8'), /changed tests import: `src\/b\.ts`\.\n$/);
  });

  it('prints the plan of the full run in shards, as a command, from the working directory', () => {
    const script = fileURLToPath(new URL('./plan.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [script, '--shards', '2'], { cwd: project, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /^mode=full\nrun=true\nmatrix=\[.*"files":"src\/a\.ts".*"files":"src\/b\.ts".*\]\nThe full run mutates 2 files in 2 shards\./);
  });

  it('reads files through fileSystem, and says that a directory is not a file', () => {
    const io = fileSystem(project);
    assert.equal(io.exists('src'), false);
    assert.equal(io.exists('src/a.ts'), true);
    assert.equal(io.exists('src/none.ts'), false);
    assert.equal(io.size('src/a.ts'), 20);
  });
});
