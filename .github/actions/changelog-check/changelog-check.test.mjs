import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { check, escapeCommand, fromEnv, run } from './changelog-check.mjs';

describe('check', () => {
  const pr = (files, extra = {}) => ({ files, labels: [], author: 'someone', ...extra });

  it('fails a change under src/ with no changelog change, naming the files and the way out', () => {
    const { problem } = check(pr(['src/a.ts', 'README.md']));
    assert.match(problem, /changes `src\/a\.ts` and not CHANGELOG\.md/);
    assert.match(problem, /label the pull request `no-changelog`/);
  });

  it('passes when the changelog changed too', () => {
    assert.equal(check(pr(['src/a.ts', 'CHANGELOG.md'])).problem, null);
  });

  it('passes a change outside the paths, and one that only touches tests', () => {
    assert.equal(check(pr(['docs/x.md', '.github/workflows/ci.yml'])).problem, null);
    assert.equal(check(pr(['src/engine/__tests__/a.ts', 'src/b.test.ts', 'src/c/d.test.tsx'])).problem, null);
  });

  it('passes with the exempting label, or for an exempt author', () => {
    assert.equal(check(pr(['src/a.ts'], { labels: ['no-changelog'] })).problem, null);
    assert.equal(check(pr(['src/a.ts'], { author: 'dependabot[bot]' })).problem, null);
  });

  it('takes its paths, ignores, changelog, label and authors from the caller', () => {
    const rules = { paths: ['lib/**', 'packages/*/src/**'], ignore: ['**/fixtures/**'], changelog: 'docs/CHANGES.md', label: 'skip-log', exemptAuthors: ['bot'] };
    assert.notEqual(check(pr(['packages/x/src/a.ts']), rules).problem, null);
    assert.equal(check(pr(['src/a.ts']), rules).problem, null);
    assert.equal(check(pr(['lib/fixtures/a.json']), rules).problem, null);
    assert.equal(check(pr(['lib/a.ts', 'docs/CHANGES.md']), rules).problem, null);
    assert.equal(check(pr(['lib/a.ts'], { labels: ['skip-log'] }), rules).problem, null);
    assert.equal(check(pr(['lib/a.ts'], { author: 'bot' }), rules).problem, null);
    assert.match(check(pr(['lib/a.ts']), rules).problem, /not docs\/CHANGES\.md/);
  });

  it('names at most three files and counts the rest', () => {
    const { problem } = check(pr(['src/a', 'src/b', 'src/c', 'src/d', 'src/e']));
    assert.match(problem, /`src\/c` and 2 more/);
    assert.doesNotMatch(problem, /src\/d/);
  });
});

describe('fromEnv', () => {
  it('reads the files one per line and the defaults when unset', () => {
    const { request, rules } = fromEnv({ CHANGED_FILES: 'src/a.ts\n\n  docs/b.md \n', PR_AUTHOR: 'me' });
    assert.deepEqual(request.files, ['src/a.ts', 'docs/b.md']);
    assert.deepEqual(rules.paths, ['src/**']);
    assert.equal(rules.label, 'no-changelog');
    assert.equal(rules.changelog, 'CHANGELOG.md');
  });

  it('treats an unreadable label list as no labels', () => {
    assert.deepEqual(fromEnv({ PR_LABELS: 'not json' }).request.labels, []);
  });
});

describe('run', () => {
  it('prints one escaped error and exits 1 on a missing entry', () => {
    const { lines, code } = run({ CHANGED_FILES: 'src/a%b\nsrc/x', PR_LABELS: '[]' });
    assert.equal(code, 1);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^::error::.*src\/a%25b/);
  });

  it('says why it passed and exits 0', () => {
    const { lines, code } = run({ CHANGED_FILES: 'src/a.ts', PR_LABELS: '["no-changelog"]' });
    assert.equal(code, 0);
    assert.deepEqual(lines, ['Changelog check passed: Labelled `no-changelog`.']);
  });

  it('escapes a line break an author put in a file name', () => {
    assert.equal(escapeCommand('a\nb\r%'), 'a%0Ab%0D%25');
  });
});
