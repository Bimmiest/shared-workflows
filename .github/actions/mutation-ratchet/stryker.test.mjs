import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeFiles, readBreak, readMutate, score, shardArtifact, shardCount, tally, tokenize } from './stryker.mjs';

/** The `mutate` list and the thresholds of propslab's config, with its comments, as of #851. */
const PROPSLAB = `// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.stryker.config.ts' },
  // Left out: the worker entry points ('*Worker.ts') and the data tables.
  mutate: [
    'src/engine/**/*.ts',
    // The date parser and the regex adapter the engine runs on.
    'src/utils/strftime.ts',
    /* Was under src/engine until #566. */ 'src/workers/workerProtocol.ts',
    '!src/engine/**/__tests__/**',
    '!src/engine/*Worker.ts',
  ],
  ignoreStatic: process.env.MUTATION_STATIC !== '1',
  // \`break\` is the floor: below it the run exits non-zero. { thresholds: 1 }
  thresholds: { high: 85, low: 83, break: process.env.MUTATION_SHARD === '1' ? null : 81 },
};
`;

/** The config of pcre2-wasm-utf16, on one line each. */
const PCRE2 = `export default {
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts', '!src/test/**'],
  thresholds: { high: 95, low: 90, break: 90 },
};`;

const mutants = (counts) => Object.entries(counts).flatMap(([status, n]) => Array.from({ length: n }, () => ({ status })));

describe('tokenize', () => {
  it('drops comments and white space, and reads strings, numbers, names and punctuation', () => {
    const tokens = tokenize(`a: 'x\\'y', // c\n /* d */ b: "q\\n", n: 1_000.5e1, t: \`p\``);
    assert.deepEqual(
      tokens.map(({ type, value }) => `${type}:${value}`),
      ['name:a', 'punct::', "string:x'y", 'punct:,', 'name:b', 'punct::', 'string:q\n', 'punct:,', 'name:n', 'punct::', 'number:1_000.5e1', 'punct:,', 'name:t', 'punct::', 'string:p'],
    );
  });

  it('marks a template literal with a substitution, and ends a line comment at the end of the text', () => {
    const tokens = tokenize('`a${b}` // end');
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].type, 'template');
  });

  it('keeps the position of each token in the text', () => {
    const [, , value] = tokenize('x: "abc"');
    assert.deepEqual([value.start, value.end], [3, 8]);
  });

  it('refuses a comment or a string that has no end', () => {
    assert.throws(() => tokenize('a /* b'), /has no \*\//);
    assert.throws(() => tokenize("a: 'b"), /starts with ' has no end/);
  });
});

describe('readMutate', () => {
  it("reads propslab's list, with the comments between its strings", () => {
    assert.deepEqual(readMutate(PROPSLAB), [
      'src/engine/**/*.ts',
      'src/utils/strftime.ts',
      'src/workers/workerProtocol.ts',
      '!src/engine/**/__tests__/**',
      '!src/engine/*Worker.ts',
    ]);
  });

  it('reads a list on one line, and a JSON config', () => {
    assert.deepEqual(readMutate(PCRE2), ['src/**/*.ts', '!src/**/*.test.ts', '!src/test/**']);
    assert.deepEqual(readMutate('{ "mutate": ["a/*.js",], "thresholds": { "break": 50 } }'), ['a/*.js']);
  });

  it('says what to change when the list is not there, twice, or not a list', () => {
    assert.throws(() => readMutate('export default {};', 'x.mjs'), /^Error: x\.mjs has no `mutate`$/);
    assert.throws(() => readMutate('const a = { mutate: [] }; const b = { mutate: [] };'), /`mutate` 2 times/);
    assert.throws(() => readMutate('export default { mutate: globs };'), /is not a list/);
  });

  it('refuses an element that is not a string literal, and names it', () => {
    assert.throws(() => readMutate("export default { mutate: ['a', ...more] };"), /holds `\.`, which is not a string literal/);
    assert.throws(() => readMutate('export default { mutate: [`src/${dir}/*.ts`] };'), /holds `\x60src\/\$\{dir\}\/\*\.ts\x60`/);
  });

  it('refuses a list with no end', () => {
    assert.throws(() => readMutate("export default { mutate: ['a', "), /has no end/);
  });
});

describe('readBreak', () => {
  it("reads the number of propslab's expression, which turns the floor off for a shard", () => {
    assert.deepEqual(readBreak(PROPSLAB), { floor: 81, text: "process.env.MUTATION_SHARD === '1' ? null : 81" });
  });

  it('reads a number, a number with separators, null, and JSON', () => {
    assert.equal(readBreak(PCRE2).floor, 90);
    assert.equal(readBreak('x = { thresholds: { break: 8_0.5 } }').floor, 80.5);
    assert.deepEqual(readBreak('x = { thresholds: { break: null, high: 90 } }'), { floor: null, text: 'null' });
    assert.equal(readBreak('{ "thresholds": { "high": 80, "break": 60 } }').floor, 60);
  });

  it('reads the break of thresholds, not one in an object inside it', () => {
    assert.equal(readBreak('x = { thresholds: { other: { break: 1 }, break: f(2), high: [3] } }').floor, 2);
  });

  it('refuses an expression that it cannot read without an import', () => {
    for (const text of ['isCI ? 81 : 70', 'base - 3', 'floor']) {
      assert.throws(() => readBreak(`x = { thresholds: { break: ${text} } }`), /cannot read without an import/, text);
    }
  });

  it('says what is missing', () => {
    assert.throws(() => readBreak('x = {}', 's.mjs'), /^Error: s\.mjs has no `thresholds`$/);
    assert.throws(() => readBreak('x = { thresholds: t }'), /is not an object literal/);
    assert.throws(() => readBreak('x = { thresholds: { high: 90 } }'), /`thresholds` in stryker\.config\.mjs has no `break`/);
    assert.throws(() => readBreak('x = { thresholds: { break: , high: 1 } }'), /has no value/);
  });
});

describe('tally', () => {
  it('counts a timeout as a detection, and a survivor and an uncovered mutant as not', () => {
    assert.deepEqual(tally(mutants({ Killed: 5, Timeout: 2, Survived: 3, NoCoverage: 1 })), { killed: 7, total: 11 });
  });

  it('leaves out the statuses that say nothing about the tests', () => {
    assert.deepEqual(tally(mutants({ Killed: 4, Ignored: 9, CompileError: 2, RuntimeError: 1, Pending: 1 })), { killed: 4, total: 4 });
  });
});

describe('score', () => {
  const report = (path, counts) => ({ files: { [path]: { mutants: mutants(counts) } } });

  it('scores the files together, not the mean of their scores', () => {
    const files = mergeFiles([report('a.ts', { Killed: 90, Survived: 10 }), report('b.ts', { Survived: 1 })]);
    assert.equal(score(files).score, (100 * 90) / 101);
  });

  it('is null when no mutant counts, and reads a report with no files', () => {
    assert.deepEqual(score({}), { killed: 0, total: 0, score: null });
    assert.deepEqual(score(undefined), { killed: 0, total: 0, score: null });
    assert.deepEqual(score({ 'a.ts': {} }), { killed: 0, total: 0, score: null });
  });
});

describe('mergeFiles', () => {
  const report = (path) => ({ files: { [path]: { mutants: mutants({ Killed: 1 }) } } });

  it('puts the files of each shard in one map', () => {
    assert.deepEqual(Object.keys(mergeFiles([report('a.ts'), {}, report('b.ts')])), ['a.ts', 'b.ts']);
  });

  it('refuses a file in two shard reports', () => {
    assert.throws(() => mergeFiles([report('a.ts'), report('a.ts')]), /^Error: a\.ts is in two shard reports/);
  });
});

describe('shardCount', () => {
  it('gives the count when each shard has a report', () => {
    assert.equal(shardCount(['mutation-report-2-of-3', 'mutation-report-1-of-3', 'mutation-report-3-of-3']), 3);
    assert.equal(shardCount([shardArtifact('m.x', 1, 1)], 'm.x'), 1);
  });

  it('names each missing shard', () => {
    assert.throws(() => shardCount(['mutation-report-2-of-4']), /^Error: There is no report from shard 1, 3, 4 of 4\.$/);
  });

  it('refuses reports with different counts, no reports, and a name of another form', () => {
    assert.throws(() => shardCount(['mutation-report-1-of-2', 'mutation-report-2-of-3']), /different shard counts/);
    assert.throws(() => shardCount([]), /no shard reports named mutation-report-<shard>-of-<count>/);
    assert.throws(() => shardCount(['mutation-report-full-1-of-2']), /is not a shard report/);
    assert.throws(() => shardCount(['mxx-1-of-1'], 'm.x'), /is not a shard report/);
  });
});
