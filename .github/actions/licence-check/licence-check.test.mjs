import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { problems, productionPackages, run, satisfies } from './licence-check.mjs';

const allowed = new Set(['MIT', 'Apache-2.0', 'BSD-3-Clause', 'GPL-2.0-only WITH Classpath-exception-2.0']);

describe('satisfies', () => {
  it('accepts a listed identifier and refuses an unlisted one', () => {
    assert.equal(satisfies('MIT', allowed), true);
    assert.equal(satisfies('GPL-3.0-only', allowed), false);
  });

  it('needs one branch of an OR and every part of an AND', () => {
    assert.equal(satisfies('(MIT OR GPL-3.0-only)', allowed), true);
    assert.equal(satisfies('MIT AND GPL-3.0-only', allowed), false);
    assert.equal(satisfies('(MIT OR GPL-3.0-only) AND Apache-2.0', allowed), true);
  });

  it('treats WITH as one term, allowed only when written that way', () => {
    assert.equal(satisfies('GPL-2.0-only WITH Classpath-exception-2.0', allowed), true);
    assert.equal(satisfies('GPL-2.0-only', allowed), false);
  });

  it('reads the legacy array and object forms as OR', () => {
    assert.equal(satisfies(['GPL-3.0-only', 'MIT'], allowed), true);
    assert.equal(satisfies({ type: 'MIT' }, allowed), true);
  });

  it('refuses nothing, blanks and expressions that do not parse', () => {
    assert.equal(satisfies(undefined, allowed), false);
    assert.equal(satisfies('', allowed), false);
    assert.equal(satisfies('(MIT', allowed), false);
    assert.equal(satisfies('MIT OR', allowed), false);
  });
});

const lock = {
  packages: {
    '': { name: 'root' },
    'packages/app': { name: '@me/app' },
    'node_modules/@me/app': { link: true, resolved: 'packages/app' },
    'node_modules/a': { version: '1.0.0', license: 'MIT' },
    'node_modules/a/node_modules/b': { version: '2.0.0', license: 'BSD-3-Clause' },
    'node_modules/dev-only': { version: '3.0.0', license: 'GPL-3.0-only', dev: true },
    'node_modules/dev-opt': { version: '3.1.0', license: 'GPL-3.0-only', devOptional: true },
    'node_modules/plat': { version: '4.0.0', license: 'MIT', optional: true },
    'node_modules/unlicensed': { version: '5.0.0' },
  },
};

describe('productionPackages', () => {
  it('lists node_modules entries that are not dev, devOptional or links, naming nested packages correctly', () => {
    const names = productionPackages(lock).map((p) => `${p.name}@${p.version}`);
    assert.deepEqual(names, ['a@1.0.0', 'b@2.0.0', 'plat@4.0.0', 'unlicensed@5.0.0']);
  });
});

describe('problems', () => {
  const allowlist = { licences: ['MIT', 'BSD-3-Clause'], packages: {} };

  it('names a package with no recorded licence and says what to do', () => {
    const out = problems(productionPackages(lock), allowlist);
    assert.equal(out.length, 1);
    assert.match(out[0], /^unlicensed@5\.0\.0 \(node_modules\/unlicensed\) has no licence recorded, which is not in/);
  });

  it('accepts a named package at a version somebody read, and refuses another version', () => {
    const named = { ...allowlist, packages: { unlicensed: { versions: ['5.0.0'], licence: 'MIT', reason: 'read it' } } };
    assert.deepEqual(problems(productionPackages(lock), named), []);
    const bumped = { packages: { ...lock.packages, 'node_modules/unlicensed': { version: '5.1.0' } } };
    const out = problems(productionPackages(bumped), named);
    assert.match(out[0], /names only 5\.0\.0 of it. Read this version's LICENSE/);
  });

  it('fails a package entry nothing needs any more', () => {
    const named = { ...allowlist, packages: { gone: { versions: ['1.0.0'], licence: 'MIT', reason: 'r' }, unlicensed: { versions: ['5.0.0'] } } };
    const out = problems(productionPackages(lock), named);
    assert.deepEqual(out, ['.licence-allowlist.json names gone@1.0.0, which no production dependency needs. Remove it.']);
  });
});

describe('run', () => {
  it('prints the count on success and annotations on failure', () => {
    const ok = run({ lock, allowlist: { licences: ['MIT', 'BSD-3-Clause'], packages: { unlicensed: { versions: ['5.0.0'] } } } });
    assert.equal(ok.code, 0);
    assert.match(ok.lines[0], /^4 production packages/);
    const bad = run({ lock, allowlist: { licences: ['MIT'] }, file: 'custom.json' });
    assert.equal(bad.code, 1);
    assert.ok(bad.lines.every((l) => l.startsWith('::error::')));
    assert.match(bad.lines.join('\n'), /custom\.json/);
  });
});
