import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { baseline, check, CORE, DOCS, layers, NODE, readExceptions, run, STACKS } from './baseline-check.mjs';

/** An `exists` for a repository that holds exactly `files`. */
const repo = (files) => (name) => files.includes(name);

/** The default list: GitHub's core set and the documentation layer. */
const GITHUB = baseline();

describe('layers', () => {
  it('with no stacks, takes the documentation layer, and Node where there is a lockfile', () => {
    assert.deepEqual(layers([], { lockfile: false }), { docs: true, node: false });
    assert.deepEqual(layers([], { lockfile: true }), { docs: true, node: true });
  });

  it('takes the documentation layer for a stack with code only', () => {
    assert.deepEqual(layers(['rust'], { lockfile: true }), { docs: true, node: false });
    assert.deepEqual(layers(['opentofu-ansible'], { lockfile: false }), { docs: true, node: false });
    for (const stack of ['container-image', 'gitops-config', 'docs-only']) {
      assert.deepEqual(layers([stack], { lockfile: true }), { docs: false, node: false }, stack);
    }
  });

  it('takes the Node files for node-ts, with or without a lockfile, and with other stacks', () => {
    assert.deepEqual(layers(['node-ts'], { lockfile: false }), { docs: true, node: true });
    assert.deepEqual(layers(['rust', 'node-ts'], { lockfile: false }), { docs: true, node: true });
  });
});

describe('baseline', () => {
  it('adds the documentation layer and the Node files only when they apply', () => {
    assert.deepEqual(baseline({ docs: false }), CORE.github);
    assert.deepEqual(baseline({ node: true }), [...CORE.github, ...DOCS, ...NODE]);
    assert.deepEqual(baseline({ forge: 'forgejo', docs: false }), CORE.forgejo);
  });

  it('keeps the Forgejo core set in .forgejo/, with Renovate and no licence', () => {
    const forgejo = baseline({ forge: 'forgejo', docs: false });
    assert.ok(forgejo.every((f) => !f.startsWith('.github/')));
    assert.ok(forgejo.includes('.forgejo/CODEOWNERS') && forgejo.includes('renovate.json'));
    for (const name of ['LICENSE', '.repo-settings.json', '.github/dependabot.yml']) assert.ok(!forgejo.includes(name), name);
  });

  it('has the same files on each forge, apart from the forge folder and the forge-only files', () => {
    const neutral = (list) => list.filter((f) => !/^\.(github|forgejo)\//.test(f));
    const onlyGithub = ['CODE_OF_CONDUCT.md', 'LICENSE', '.repo-settings.json', '.git-blame-ignore-revs', '.claude/settings.json'];
    assert.deepEqual(neutral(CORE.github).filter((f) => !onlyGithub.includes(f)), neutral(CORE.forgejo).filter((f) => f !== 'renovate.json'));
  });
});

describe('the Claude Code settings', () => {
  it('are a core file on GitHub, and not yet on Forgejo', () => {
    assert.ok(CORE.github.includes('.claude/settings.json'));
    assert.ok(!CORE.forgejo.includes('.claude/settings.json'));
  });

  it('are missing in a repository with CLAUDE.md and no settings, and an exception with a reason excuses them', () => {
    const files = GITHUB.filter((f) => f !== '.claude/settings.json');
    assert.deepEqual(check(repo(files), []), {
      lines: [
        '::error::.claude/settings.json is missing. Take it from repo-template, or add { "file": ".claude/settings.json", "reason": "…" } to .baseline-exceptions.json.',
      ],
      code: 1,
    });
    assert.equal(check(repo(files), [{ file: '.claude/settings.json', reason: 'Nobody runs Claude Code here.' }]).code, 0);
  });

  it('do not bring the git hooks onto a list: a hook is a local help that CI repeats', () => {
    const all = [...CORE.github, ...CORE.forgejo, ...DOCS, ...NODE];
    assert.ok(!all.some((f) => f.startsWith('.githooks/')));
  });
});

describe('check', () => {
  it('passes a repository with every core file', () => {
    assert.deepEqual(check(repo(GITHUB), []), { lines: [`${GITHUB.length} baseline files are present.`], code: 0 });
  });

  it('asks for the Node files once there is a package-lock.json', () => {
    const { lines, code } = check(repo([...GITHUB, 'package-lock.json']), []);
    assert.equal(code, 1);
    assert.equal(lines.length, NODE.length);
    assert.match(lines[0], /^::error::\.audit-exceptions\.json is missing\. Take it from repo-template/);
  });

  it('names each missing file, and the exception that would excuse it', () => {
    const { lines, code } = check(repo(GITHUB.filter((f) => f !== 'SECURITY.md')), []);
    assert.equal(code, 1);
    assert.deepEqual(lines, [
      '::error::SECURITY.md is missing. Take it from repo-template, or add { "file": "SECURITY.md", "reason": "…" } to .baseline-exceptions.json.',
    ]);
  });

  it('passes a missing file that has an exception, and counts it', () => {
    const files = GITHUB.filter((f) => f !== 'CHANGELOG.md');
    const { lines, code } = check(repo(files), [{ file: 'CHANGELOG.md', reason: 'The commit is the release.' }]);
    assert.equal(code, 0);
    assert.deepEqual(lines, [`${GITHUB.length - 1} baseline files are present, and 1 is excepted in .baseline-exceptions.json.`]);
  });

  it('fails an exception for a file that exists', () => {
    const { lines, code } = check(repo(GITHUB), [{ file: 'LICENSE', reason: 'Private.' }]);
    assert.equal(code, 1);
    assert.deepEqual(lines, ['::error file=.baseline-exceptions.json::LICENSE exists. Remove its exception.']);
  });

  it('fails an exception for a file that is not on the list for this repository', () => {
    const { lines } = check(repo(GITHUB), [{ file: '.nvmrc', reason: 'No Node.' }, { file: 'TYPO.md', reason: 'x' }]);
    assert.deepEqual(lines, [
      '::error file=.baseline-exceptions.json::.nvmrc is not a baseline file of this repository. Remove its exception.',
      '::error file=.baseline-exceptions.json::TYPO.md is not a baseline file of this repository. Remove its exception.',
    ]);
  });

  it('fails an exception with no reason, and still reports the file as missing', () => {
    const { lines, code } = check(repo(GITHUB.filter((f) => f !== 'LICENSE')), [{ file: 'LICENSE', reason: ' ' }]);
    assert.equal(code, 1);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /Each exception needs a `file` and a `reason`/);
    assert.match(lines[1], /^::error::LICENSE is missing/);
  });

  it('passes a Forgejo config repository with the Forgejo core set only', () => {
    const options = { forge: 'forgejo', stacks: ['gitops-config'] };
    assert.deepEqual(check(repo(CORE.forgejo), [], options), { lines: [`${CORE.forgejo.length} baseline files are present.`], code: 0 });
  });

  it('on Forgejo, sends a missing file to the Forgejo template', () => {
    const { lines } = check(repo(CORE.forgejo.filter((f) => f !== 'renovate.json')), [], { forge: 'forgejo', stacks: ['docs-only'] });
    assert.deepEqual(lines, [
      '::error::renovate.json is missing. Take it from pipelines/repo-template, or add { "file": "renovate.json", "reason": "…" } to .baseline-exceptions.json.',
    ]);
  });

  it('holds a Rust repository to the documentation layer, and not to the Node files', () => {
    const { lines, code } = check(repo([...CORE.forgejo, 'package-lock.json']), [], { forge: 'forgejo', stacks: ['rust'] });
    assert.equal(code, 1);
    assert.deepEqual(lines.map((l) => l.match(/^::error::(\S+) is missing/)?.[1]), DOCS);
  });

  it('fails an exception for a file of a layer that does not apply', () => {
    const { lines } = check(repo(CORE.forgejo), [{ file: 'docs/ci.md', reason: 'No CI.' }], { forge: 'forgejo', stacks: ['gitops-config'] });
    assert.deepEqual(lines, ['::error file=.baseline-exceptions.json::docs/ci.md is not a baseline file of this repository. Remove its exception.']);
  });

  it('refuses a forge or a stack that it does not know, and checks nothing', () => {
    assert.deepEqual(check(repo([]), [], { forge: 'gitea' }), {
      lines: ["::error::forge must be one of github, forgejo, not 'gitea'."],
      code: 1,
    });
    assert.deepEqual(check(repo([]), [], { stacks: ['node-ts,rust'] }), {
      lines: [`::error::'node-ts,rust' is not a stack. Use one or more of ${STACKS.join(', ')}.`],
      code: 1,
    });
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
    for (const name of GITHUB.filter((f) => f !== 'LICENSE')) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), '');
    }
    writeFileSync(path.join(root, 'x.json'), JSON.stringify({ exceptions: [{ file: 'LICENSE', reason: 'Private.' }] }));
    assert.deepEqual(run(root, 'x.json'), { lines: [`${GITHUB.length - 1} baseline files are present, and 1 is excepted in x.json.`], code: 0 });
  });

  it('takes the forge and a space-separated list of stacks', () => {
    const { lines, code } = run(root, 'x.json', { forge: 'forgejo', stacks: ' gitops-config  docs-only ' });
    assert.equal(code, 1);
    assert.ok(lines.some((l) => l.startsWith('::error::.forgejo/CODEOWNERS is missing')));
    assert.ok(!lines.some((l) => l.includes('docs/ci.md')));
  });

  it('turns an unreadable config into a failure that names it', () => {
    writeFileSync(path.join(root, 'broken.json'), '{');
    const { lines, code } = run(root, 'broken.json');
    assert.equal(code, 1);
    assert.match(lines[0], /^::error file=broken\.json::/);
  });
});
