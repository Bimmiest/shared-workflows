import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { check, differences, literal, overrides, parseAllowlist, projectEslint, run } from './lint-allowlist-check.mjs';

/** A stand-in for the caller's ESLint: each file gets the messages in `found`, and the options are kept. */
function fakeEslint(found) {
  return class {
    static last;
    constructor(options) {
      this.options = options;
      this.constructor.last = options;
    }
    async lintFiles(files) {
      return files.map((file) => ({
        filePath: path.resolve(this.options.cwd, file),
        messages: (found[file] ?? []).map((ruleId) => (typeof ruleId === 'string' ? { ruleId } : ruleId)),
      }));
    }
  };
}

let cwd;
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), 'lint-allowlist-'));
  mkdirSync(path.join(cwd, 'src', '[id]'), { recursive: true });
  writeFileSync(path.join(cwd, 'src', 'a.ts'), '');
  writeFileSync(path.join(cwd, 'src', '[id]', 'page.ts'), '');
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  mock.restoreAll();
});

describe('parseAllowlist', () => {
  it('reads the files and their counts', () => {
    assert.deepEqual(parseAllowlist('{"files": {"src/a.ts": {"no-console": 2}}}'), { 'src/a.ts': { 'no-console': 2 } });
  });

  it('refuses a list without files, a file without rules, and a count that is not 1 or more', () => {
    for (const text of ['{}', 'null', '{"files": []}', '{"files": {"a": null}}', '{"files": {"a": []}}', '{"files": {"a": {"r": 0}}}', '{"files": {"a": {"r": 1.5}}}']) {
      assert.throws(() => parseAllowlist(text, 'x.json'), /x\.json must have "files"/, text);
    }
  });
});

describe('literal and overrides', () => {
  it('escapes the characters that make a path a glob', () => {
    assert.equal(literal('src/routes/[id]/+page.ts'), 'src/routes/\\[id\\]/\\+page.ts');
  });

  it('turns each listed rule on again with a severity alone, so its options stay', () => {
    assert.deepEqual(overrides({ 'src/a.ts': { 'no-console': 2, 'no-restricted-syntax': 1 } }), [
      { files: ['src/a.ts'], rules: { 'no-console': 'error', 'no-restricted-syntax': 'error' } },
    ]);
  });
});

describe('differences', () => {
  const rules = { 'no-console': 2, eqeqeq: 1 };

  it('is empty when each count is what the rule finds, and ignores the rules that are not listed', () => {
    assert.deepEqual(differences('a.ts', rules, [{ ruleId: 'no-console' }, { ruleId: 'no-console' }, { ruleId: 'eqeqeq' }, { ruleId: 'semi' }, { ruleId: null }]), []);
  });

  it('says "fix" for a higher count and "lower" for a lower one', () => {
    const found = differences('a.ts', rules, [{ ruleId: 'no-console' }, { ruleId: 'no-console' }, { ruleId: 'no-console' }]);
    assert.equal(found.length, 2);
    assert.match(found[0], /^a\.ts: no-console finds 3, and the allowlist says 2\. Fix the new finding/);
    assert.match(found[1], /^a\.ts: eqeqeq finds 0, and the allowlist says 1\. Lower the count/);
  });

  it('names a file that could not be linted', () => {
    const [first] = differences('a.ts', { eqeqeq: 1 }, [{ ruleId: null, fatal: true, message: 'Parsing error' }]);
    assert.equal(first, 'a.ts could not be linted: Parsing error');
  });
});

describe('check', () => {
  it('passes when each count holds, with the path escaped and a "./" path normalised', async () => {
    const ESLint = fakeEslint({ './src/a.ts': ['no-console'], 'src/[id]/page.ts': ['eqeqeq'] });
    const files = { './src/a.ts': { 'no-console': 1 }, 'src/[id]/page.ts': { eqeqeq: 1 } };
    assert.deepEqual(await check({ ESLint, cwd, files }), []);
    assert.deepEqual(ESLint.last.overrideConfig.map((block) => block.files[0]), ['src/a.ts', 'src/\\[id\\]/page.ts']);
  });

  it('names a listed file that does not exist, and lints nothing when no listed file exists', async () => {
    const ESLint = fakeEslint({});
    assert.deepEqual(await check({ ESLint, cwd, files: { 'src/gone.ts': { eqeqeq: 1 } } }), [
      'src/gone.ts is in the allowlist and does not exist. Take it off the list.',
    ]);
    assert.equal(ESLint.last, undefined);
  });

  it('names a result for a file that is not in the list', async () => {
    const ESLint = class {
      async lintFiles() {
        return [{ filePath: '/elsewhere/b.ts', messages: [] }];
      }
    };
    assert.deepEqual(await check({ ESLint, cwd, files: { 'src/a.ts': { eqeqeq: 1 } } }), [
      'ESLint linted /elsewhere/b.ts, which is not in the allowlist.',
    ]);
  });
});

describe('run', () => {
  const log = () => {
    const lines = [];
    mock.method(console, 'log', (line) => lines.push(line));
    return lines;
  };

  it('returns 0 and says what it holds when each count holds', async () => {
    writeFileSync(path.join(cwd, 'list.json'), '{"files": {"src/a.ts": {"no-console": 2}}}');
    const lines = log();
    const code = await run({ cwd, allowlist: 'list.json', loadEslint: () => fakeEslint({ 'src/a.ts': ['no-console', 'no-console'] }) });
    assert.equal(code, 0);
    assert.match(lines.at(-1), /holds 2 findings in 1 files/);
  });

  it('returns 1 with one annotation for each problem', async () => {
    writeFileSync(path.join(cwd, 'list.json'), '{"files": {"src/a.ts": {"no-console": 2}}}');
    const lines = log();
    assert.equal(await run({ cwd, allowlist: 'list.json', loadEslint: () => fakeEslint({}) }), 1);
    assert.deepEqual(lines, ['::error title=Lint allowlist::src/a.ts: no-console finds 0, and the allowlist says 2. Lower the count in the allowlist, in this change.']);
  });

  it('returns 1 with the reason when the allowlist is missing or ESLint is not installed', async () => {
    const lines = log();
    assert.equal(await run({ cwd, allowlist: 'none.json' }), 1);
    assert.match(lines[0], /^::error::ENOENT/);
    writeFileSync(path.join(cwd, 'list.json'), '{"files": {}}');
    assert.equal(await run({ cwd, allowlist: 'list.json' }), 1);
    assert.match(lines[1], /^::error::No eslint is installed in .*Run the check after npm ci\.$/);
  });
});

describe('projectEslint', () => {
  it('loads the ESLint class of the project in cwd', () => {
    mkdirSync(path.join(cwd, 'node_modules', 'eslint'), { recursive: true });
    writeFileSync(path.join(cwd, 'node_modules', 'eslint', 'package.json'), '{"name": "eslint", "main": "api.js"}');
    writeFileSync(path.join(cwd, 'node_modules', 'eslint', 'api.js'), 'exports.ESLint = class Stand {};');
    assert.equal(projectEslint(cwd).name, 'Stand');
  });
});
