import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { problems, run, satisfies, shippedPackages } from './licence-check.mjs';

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

describe('shippedPackages', () => {
  it('lists node_modules entries that are not dev, devOptional or links, naming nested packages correctly', () => {
    const names = shippedPackages(lock).map((p) => `${p.name}@${p.version}`);
    assert.deepEqual(names, ['a@1.0.0', 'b@2.0.0', 'plat@4.0.0', 'unlicensed@5.0.0']);
  });

  it('adds the dev and devOptional entries with includeDev, and still skips the root, workspaces and links', () => {
    const names = shippedPackages(lock, { includeDev: true }).map((p) => `${p.name}@${p.version}`);
    assert.deepEqual(names, ['a@1.0.0', 'b@2.0.0', 'dev-only@3.0.0', 'dev-opt@3.1.0', 'plat@4.0.0', 'unlicensed@5.0.0']);
  });
});

describe('problems', () => {
  const allowlist = { licences: ['MIT', 'BSD-3-Clause'], packages: {} };

  it('names a package with no recorded licence and says what to do', () => {
    const out = problems(shippedPackages(lock), allowlist);
    assert.equal(out.length, 1);
    assert.match(out[0], /^unlicensed@5\.0\.0 \(node_modules\/unlicensed\) has no licence recorded, which is not in/);
  });

  it('accepts a named package at a version somebody read, and refuses another version', () => {
    const named = { ...allowlist, packages: { unlicensed: { versions: ['5.0.0'], licence: 'MIT', reason: 'read it' } } };
    assert.deepEqual(problems(shippedPackages(lock), named), []);
    const bumped = { packages: { ...lock.packages, 'node_modules/unlicensed': { version: '5.1.0' } } };
    const out = problems(shippedPackages(bumped), named);
    assert.match(out[0], /names only 5\.0\.0 of it. Read this version's LICENSE/);
  });

  it('fails a package entry nothing needs any more', () => {
    const named = { ...allowlist, packages: { gone: { versions: ['1.0.0'], licence: 'MIT', reason: 'r' }, unlicensed: { versions: ['5.0.0'] } } };
    const out = problems(shippedPackages(lock), named);
    assert.deepEqual(out, ['.licence-allowlist.json names gone@1.0.0, which no production dependency needs. Remove it.']);
  });

  it('uses an entry for a dev package only with includeDev, and names the scope of a stale entry', () => {
    const named = { licences: ['MIT', 'BSD-3-Clause'], packages: { 'dev-only': { versions: ['3.0.0'] }, unlicensed: { versions: ['5.0.0'] } } };
    assert.deepEqual(problems(shippedPackages(lock), named), [
      '.licence-allowlist.json names dev-only@3.0.0, which no production dependency needs. Remove it.',
    ]);
    const dev = problems(shippedPackages(lock, { includeDev: true }), named, '.licence-allowlist.json', { includeDev: true });
    assert.equal(dev.length, 1);
    assert.match(dev[0], /^dev-opt@3\.1\.0 \(node_modules\/dev-opt\) has `"GPL-3\.0-only"`, which is not in/);
    const gone = { ...named, packages: { ...named.packages, 'dev-opt': { versions: ['3.1.0'] }, gone: { versions: ['1.0.0'] } } };
    const stale = problems(shippedPackages(lock, { includeDev: true }), gone, '.licence-allowlist.json', { includeDev: true });
    assert.deepEqual(stale, ['.licence-allowlist.json names gone@1.0.0, which no dependency needs. Remove it.']);
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

  it('checks the dev packages with includeDev, and counts them on success', () => {
    const allowlist = { licences: ['MIT', 'BSD-3-Clause', 'GPL-3.0-only'], packages: { unlicensed: { versions: ['5.0.0'] } } };
    const ok = run({ lock, allowlist, includeDev: true });
    assert.equal(ok.code, 0);
    assert.deepEqual(ok.lines, ['6 production and dev packages: every licence is on the allowlist.']);
    const bad = run({ lock, allowlist: { ...allowlist, licences: ['MIT', 'BSD-3-Clause'] }, includeDev: true });
    assert.equal(bad.code, 1);
    assert.deepEqual(bad.lines.map((l) => l.split(' ')[0]), ['::error::dev-only@3.0.0', '::error::dev-opt@3.1.0']);
  });
});
