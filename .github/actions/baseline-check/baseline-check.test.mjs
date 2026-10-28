import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { baseline, check, CORE, NODE, readExceptions, run } from './baseline-check.mjs';

/** An `exists` for a repository that holds exactly `files`. */
const repo = (files) => (name) => files.includes(name);

describe('baseline', () => {
  it('adds the Node files only where there is a Node toolchain', () => {
    assert.deepEqual(baseline({ node: false }), CORE);
    assert.deepEqual(baseline({ node: true }), [...CORE, ...NODE]);
  });
});

describe('check', () => {
  it('passes a repository with every core file', () => {
    assert.deepEqual(check(repo(CORE), []), { lines: [`${CORE.length} baseline files are present.`], code: 0 });
  });

  it('asks for the Node files once there is a package-lock.json', () => {
    const { lines, code } = check(repo([...CORE, 'package-lock.json']), []);
    assert.equal(code, 1);
    assert.equal(lines.length, NODE.length);
    assert.match(lines[0], /^::error::\.audit-exceptions\.json is missing\. Take it from repo-template/);
  });

  it('names each missing file, and the exception that would excuse it', () => {
    const { lines, code } = check(repo(CORE.filter((f) => f !== 'SECURITY.md')), []);
    assert.equal(code, 1);
    assert.deepEqual(lines, [
      '::error::SECURITY.md is missing. Take it from repo-template, or add { "file": "SECURITY.md", "reason": "…" } to .baseline-exceptions.json.',
    ]);
  });

  it('passes a missing file that has an exception, and counts it', () => {
    const files = CORE.filter((f) => f !== 'CHANGELOG.md');
    const { lines, code } = check(repo(files), [{ file: 'CHANGELOG.md', reason: 'The commit is the release.' }]);
    assert.equal(code, 0);
    assert.deepEqual(lines, [`${CORE.length - 1} baseline files are present, and 1 is excepted in .baseline-exceptions.json.`]);
  });

  it('fails an exception for a file that exists', () => {
    const { lines, code } = check(repo(CORE), [{ file: 'LICENSE', reason: 'Private.' }]);
    assert.equal(code, 1);
    assert.deepEqual(lines, ['::error file=.baseline-exceptions.json::LICENSE exists. Remove its exception.']);
  });

  it('fails an exception for a file that is not on the list for this repository', () => {
    const { lines } = check(repo(CORE), [{ file: '.nvmrc', reason: 'No Node.' }, { file: 'TYPO.md', reason: 'x' }]);
    assert.deepEqual(lines, [
      '::error file=.baseline-exceptions.json::.nvmrc is not a baseline file of this repository. Remove its exception.',
      '::error file=.baseline-exceptions.json::TYPO.md is not a baseline file of this repository. Remove its exception.',
    ]);
  });

  it('fails an exception with no reason, and still reports the file as missing', () => {
    const { lines, code } = check(repo(CORE.filter((f) => f !== 'LICENSE')), [{ file: 'LICENSE', reason: ' ' }]);
    assert.equal(code, 1);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /Each exception needs a `file` and a `reason`/);
    assert.match(lines[1], /^::error::LICENSE is missing/);
  });
});

describe('readExceptions', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'baseline-check-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name, text) => {
    const file = path.join(dir, name);
    writeFileSync(file, text);
    return file;
  };

  it('is empty when there is no config file', () => {
    assert.deepEqual(readExceptions(path.join(dir, 'absent.json')), []);
  });

  it('returns the exceptions list', () => {
    const list = [{ file: 'LICENSE', reason: 'Private.' }];
    assert.deepEqual(readExceptions(write('good.json', JSON.stringify({ exceptions: list }))), list);
  });

  it('refuses a config with no exceptions list', () => {
    assert.throws(() => readExceptions(write('bad.json', '{"exceptions": {}}')), /must have an "exceptions" list/);
  });
});

describe('run', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'baseline-run-'));
  after(() => rmSync(root, { recursive: true, force: true }));

  it('checks the files under the root, with the exceptions there', () => {
    for (const name of CORE.filter((f) => f !== 'LICENSE')) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), '');
    }
    writeFileSync(path.join(root, 'x.json'), JSON.stringify({ exceptions: [{ file: 'LICENSE', reason: 'Private.' }] }));
    assert.deepEqual(run(root, 'x.json'), { lines: [`${CORE.length - 1} baseline files are present, and 1 is excepted in x.json.`], code: 0 });
  });

  it('turns an unreadable config into a failure that names it', () => {
    writeFileSync(path.join(root, 'broken.json'), '{');
    const { lines, code } = run(root, 'broken.json');
    assert.equal(code, 1);
    assert.match(lines[0], /^::error file=broken\.json::/);
  });
});
