import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { isNestedCopy, newNestedCopies, packageName, run, verdict } from './lockfile-nesting.mjs';

const fixture = (name) => fileURLToPath(new URL(`../../../test/fixtures/lockfile-nesting-check/${name}`, import.meta.url));
const lock = (packages) => ({ lockfileVersion: 3, packages });

describe('packageName', () => {
  it('is the part after the last node_modules/, a scope included', () => {
    assert.equal(packageName('node_modules/a/node_modules/@s/b'), '@s/b');
    assert.equal(packageName('packages/x/node_modules/b'), 'b');
  });
});

describe('isNestedCopy', () => {
  const packages = {
    '': {},
    'node_modules/a': {},
    'node_modules/b': {},
    'node_modules/a/node_modules/b': {},
    'packages/x': {},
    'packages/x/node_modules/b': {},
    'packages/x/node_modules/only-here': {},
    'node_modules/x': { link: true },
  };

  it('is true under another package, and under a workspace while the root has the package', () => {
    assert.equal(isNestedCopy('node_modules/a/node_modules/b', packages), true);
    assert.equal(isNestedCopy('packages/x/node_modules/b', packages), true);
  });

  it('is false for the top level, a workspace, a link, and a package only the workspace has', () => {
    for (const key of ['', 'node_modules/a', 'packages/x', 'node_modules/x', 'packages/x/node_modules/only-here']) {
      assert.equal(isNestedCopy(key, packages), false, key);
    }
  });
});

describe('newNestedCopies', () => {
  it('reports a nested copy that the base did not have, with both versions', () => {
    const base = lock({ 'node_modules/a': { version: '1.0.0' }, 'node_modules/b': { version: '2.0.0' } });
    const head = lock({ ...base.packages, 'node_modules/a/node_modules/b': { version: '1.0.0' } });
    assert.deepEqual(newNestedCopies(base, head), [
      { name: 'b', path: 'node_modules/a/node_modules/b', nested: '1.0.0', top: '2.0.0' },
    ]);
  });

  it('leaves out a nested copy that the base already had', () => {
    const both = lock({ 'node_modules/b': { version: '2.0.0' }, 'node_modules/a/node_modules/b': { version: '1.0.0' } });
    assert.deepEqual(newNestedCopies(both, both), []);
  });

  it('gives null for a version that the lockfile does not record', () => {
    const head = lock({ 'node_modules/a/node_modules/b': {} });
    assert.deepEqual(newNestedCopies(lock({}), head), [{ name: 'b', path: 'node_modules/a/node_modules/b', nested: null, top: null }]);
  });

  it('reads a lockfile with no packages as empty', () => {
    assert.deepEqual(newNestedCopies({}, {}), []);
  });
});

describe('verdict', () => {
  const copy = { name: 'b', path: 'node_modules/a/node_modules/b', nested: '1.0.0', top: '2.0.0' };

  it('passes with nothing new', () => {
    assert.deepEqual(verdict([]), { lines: ['package-lock.json: no new nested copy of a package.'], code: 0 });
  });

  it('warns by default, naming both versions and what to do', () => {
    const { lines, code } = verdict([copy]);
    assert.equal(code, 0);
    assert.match(lines[0], /^::warning file=package-lock\.json,title=Nested copy of b::node_modules\/a\/node_modules\/b is b 1\.0\.0, and the top level has 2\.0\.0\./);
    assert.match(lines[0], /Run `npm dedupe`, or update the related packages in one change\.$/);
  });

  it('fails at level fail, and says when a version is missing', () => {
    const { lines, code } = verdict([{ ...copy, nested: null, top: null }], { level: 'fail', file: 'x/package-lock.json' });
    assert.equal(code, 1);
    assert.match(lines[0], /^::error file=x\/package-lock\.json,title=Nested copy of b::.* is b \(no version\), and the top level has none\./);
  });
});

describe('run, on the fixtures', () => {
  it('passes the fixture whose only nesting was already on the base', () => {
    assert.equal(run({ cwd: fixture('pass'), base: 'base-package-lock.json' }), 0);
  });

  it('only warns on the fixture with new nesting, and fails it at level fail', () => {
    assert.equal(run({ cwd: fixture('fail'), base: 'base-package-lock.json' }), 0);
    assert.equal(run({ cwd: fixture('fail'), base: 'base-package-lock.json', level: 'fail' }), 1);
  });

  it('fails on a level it does not know, and on a base that it cannot read', () => {
    assert.equal(run({ cwd: fixture('pass'), base: 'base-package-lock.json', level: 'loud' }), 1);
    assert.equal(run({ cwd: fixture('pass'), baseRef: 'no-such-revision' }), 1);
  });
});
