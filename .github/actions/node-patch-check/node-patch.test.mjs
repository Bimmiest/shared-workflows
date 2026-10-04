import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareVersions, latestOfMajor, parseVersion, verdict } from './node-patch.mjs';

describe('parseVersion', () => {
  it('reads x.y.z with or without a v, and nothing else', () => {
    assert.deepEqual(parseVersion('v24.18.1'), [24, 18, 1]);
    assert.deepEqual(parseVersion(' 24.18.1\n'), [24, 18, 1]);
    assert.equal(parseVersion('24'), null);
    assert.equal(parseVersion('lts/krypton'), null);
  });
});

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    assert.ok(compareVersions([24, 9, 0], [24, 10, 0]) < 0);
    assert.ok(compareVersions([25, 0, 0], [24, 99, 99]) > 0);
    assert.equal(compareVersions([1, 2, 3], [1, 2, 3]), 0);
  });
});

describe('latestOfMajor', () => {
  const index = [{ version: 'v25.1.0' }, { version: 'v24.18.1' }, { version: 'v24.21.0' }, { version: 'v24.20.0' }, { version: 'nonsense' }, {}];

  it('finds the newest release on the line, whatever the order', () => {
    assert.deepEqual(latestOfMajor(index, 24), [24, 21, 0]);
  });

  it('never looks at a newer major, and is null for an absent line', () => {
    assert.deepEqual(latestOfMajor(index, 25), [25, 1, 0]);
    assert.equal(latestOfMajor(index, 22), null);
  });
});

describe('verdict', () => {
  it('passes a pin that is current', () => {
    assert.deepEqual(verdict([24, 21, 0], [24, 21, 0]), { line: '.nvmrc (24.21.0) is the newest 24.x release.', code: 0 });
  });

  it('fails a pin that is behind, naming the release notes', () => {
    const { line, code } = verdict([24, 20, 0], [24, 21, 0]);
    assert.equal(code, 1);
    assert.match(line, /^::error title=Node patch available::\.nvmrc pins Node 24\.20\.0 but 24\.21\.0 is out/);
    assert.match(line, /release\/v24\.21\.0$/);
  });

  it('only warns under --warn-only', () => {
    const { line, code } = verdict([24, 20, 0], [24, 21, 0], { warnOnly: true });
    assert.equal(code, 0);
    assert.match(line, /^::warning title=Node patch available::/);
  });

  it('fails when the line has no release at all', () => {
    assert.equal(verdict([99, 0, 0], null).code, 1);
  });
});
