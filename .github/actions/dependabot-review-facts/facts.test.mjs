import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { changedPackages, collect, importSites, isZeroMinor, LIMITS, run } from './facts.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const lock = (packages) => ({ lockfileVersion: 3, packages });

describe('isZeroMinor', () => {
  it('is true only for a 0.x package whose minor version moved', () => {
    assert.equal(isZeroMinor('0.3.1', '0.4.0'), true);
    assert.equal(isZeroMinor('0.3.1', '0.3.9'), false);
    assert.equal(isZeroMinor('1.3.1', '1.4.0'), false);
    assert.equal(isZeroMinor(null, '0.4.0'), false);
  });
});

describe('changedPackages', () => {
  it('lists each changed, added and removed top-level package, sorted, and not nested ones or links', () => {
    const base = lock({ '': {}, 'node_modules/b': { version: '0.1.0' }, 'node_modules/a': { version: '1.0.0' }, 'node_modules/gone': { version: '1.0.0' }, 'node_modules/same': { version: '2.0.0' } });
    const head = lock({
      '': {},
      'node_modules/a': { version: '1.1.0' },
      'node_modules/b': { version: '0.2.0' },
      'node_modules/new': { version: '3.0.0' },
      'node_modules/same': { version: '2.0.0' },
      'node_modules/a/node_modules/c': { version: '9.0.0' },
      'node_modules/ws': { link: true },
    });
    assert.deepEqual(changedPackages(base, head), [
      { name: 'a', from: '1.0.0', to: '1.1.0', zeroMinor: false },
      { name: 'b', from: '0.1.0', to: '0.2.0', zeroMinor: true },
      { name: 'gone', from: '1.0.0', to: null, zeroMinor: false },
      { name: 'new', from: null, to: '3.0.0', zeroMinor: false },
    ]);
  });
});

describe('importSites', () => {
  it('finds where this repository names a package in quotes, with file and line', () => {
    const sites = importSites('node:test', repoRoot);
    assert.ok(sites.length > 0);
    assert.ok(sites.every((s) => typeof s.file === 'string' && Number.isInteger(s.line) && s.line > 0));
    assert.ok(sites.length <= LIMITS.sitesPerPackage);
  });

  it('is empty for a name nothing uses, and respects the limit', () => {
    assert.deepEqual(importSites('no-such-package-anywhere-81', repoRoot), []);
    assert.equal(importSites('node:test', repoRoot, 1).length, 1);
  });
});

describe('collect', () => {
  it('bounds the title and the body, and adds the sites and the nested copies', () => {
    const base = lock({ 'node_modules/b': { version: '2.0.0' } });
    const head = lock({ 'node_modules/b': { version: '2.0.0' }, 'node_modules/a/node_modules/b': { version: '1.0.0' }, 'node_modules/a': { version: '1.0.0' } });
    const event = { pull_request: { number: 7, user: { login: 'dependabot[bot]' }, title: 't'.repeat(1000), body: 'b'.repeat(50_000), head: { sha: 'abc' } } };
    const facts = collect({ base, head, event, cwd: repoRoot });
    assert.equal(facts.pullRequest.number, 7);
    assert.equal(facts.pullRequest.author, 'dependabot[bot]');
    assert.equal(facts.pullRequest.title.length, LIMITS.title);
    assert.equal(facts.pullRequest.body.length, LIMITS.body);
    assert.equal(facts.pullRequest.headSha, 'abc');
    assert.deepEqual(facts.packages.map((p) => p.name), ['a']);
    assert.ok(Array.isArray(facts.packages[0].sites));
    assert.equal(facts.nestedCopies.length, 1);
  });

  it('reads an event with no pull request as empty', () => {
    const facts = collect({ base: lock({}), head: lock({}), event: {}, cwd: repoRoot });
    assert.deepEqual(facts.pullRequest, { number: null, author: null, title: '', body: '', headSha: null });
  });
});

describe('run', () => {
  it('writes the facts of a lockfile against itself at HEAD, which has no change', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'facts-'));
    try {
      const out = path.join(dir, 'facts.json');
      const event = path.join(dir, 'event.json');
      writeFileSync(event, JSON.stringify({ pull_request: { number: 3 } }));
      const cwd = path.join(repoRoot, 'test/fixtures/project');
      assert.equal(run({ cwd, baseRef: 'HEAD', out, eventPath: event }), 0);
      const facts = JSON.parse(readFileSync(out, 'utf8'));
      assert.equal(facts.pullRequest.number, 3);
      assert.deepEqual(facts.packages, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when the lockfile is missing', () => {
    assert.equal(run({ cwd: repoRoot, lockfile: 'no-such-lockfile.json', eventPath: undefined }), 1);
  });
});
