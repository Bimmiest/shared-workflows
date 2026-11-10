import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { parseConfig, problems, run } from './package-contents-check.mjs';

const fixture = (name) => fileURLToPath(new URL(`../../../test/fixtures/package-contents-check/${name}`, import.meta.url));

describe('parseConfig', () => {
  it('reads the two lists, and compiles each forbidden pattern', () => {
    const { required, forbidden } = parseConfig('{"required": ["LICENSE"], "forbidden": ["\\\\.test\\\\.js$"]}');
    assert.deepEqual(required, ['LICENSE']);
    assert.ok(forbidden[0].test('src/a.test.js'));
  });

  it('refuses a config without both lists of strings, and a pattern that does not compile', () => {
    assert.throws(() => parseConfig('{"required": ["LICENSE"]}'), /must have "required" and "forbidden"/);
    assert.throws(() => parseConfig('{"required": [1], "forbidden": []}'), /must have/);
    assert.throws(() => parseConfig('{"required": [], "forbidden": ["("]}'), SyntaxError);
  });
});

describe('problems', () => {
  const rules = { required: ['LICENSE', 'index.js'], forbidden: [/\.test\.js$/, /^docs\//] };

  it('is empty when each required path ships and no forbidden one does', () => {
    assert.deepEqual(problems(['LICENSE', 'index.js', 'package.json'], rules), []);
  });

  it('names each missing path and each path that should not ship', () => {
    assert.deepEqual(problems(['index.js', 'index.test.js', 'docs/a.md'], rules), [
      'missing: LICENSE',
      'should not ship: index.test.js',
      'should not ship: docs/a.md',
    ]);
  });
});

describe('run, against npm pack', () => {
  it('passes the fixture whose files list is right', () => {
    assert.equal(run({ cwd: fixture('pass') }), 0);
  });

  it('fails the fixture that ships its test and no licence', () => {
    assert.equal(run({ cwd: fixture('fail') }), 1);
  });

  it('fails when there is no config', () => {
    assert.equal(run({ cwd: fixture('pass'), config: 'absent.json' }), 1);
  });
});
