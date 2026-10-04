import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { branchIssue, branchPattern, check, escapeCommand, fromEnv, linkedIssues, run } from './pr-hygiene.mjs';

describe('branchPattern', () => {
  const pattern = branchPattern();

  it('accepts the convention and refuses everything else', () => {
    for (const ok of ['feature/git-worktree-service-5', 'fix/push-guard-31', 'docs/adr-review-23', 'chore/deps', 'ci/x-1']) {
      assert.ok(pattern.test(ok), ok);
    }
    for (const bad of ['claude/fix-thing-1', 'feature/Upper-1', 'feature/', 'feature/-x-1', 'feat/x-1', 'fix/under_score-1', 'main']) {
      assert.ok(!pattern.test(bad), bad);
    }
  });

  it('takes its type list from the caller and escapes it', () => {
    const custom = branchPattern(['feat', 'release.x']);
    assert.ok(custom.test('feat/x-1'));
    assert.ok(custom.test('release.x/v2-9'));
    assert.ok(!custom.test('releasex/v2-9'));
    assert.ok(!custom.test('feature/x-1'));
  });
});

describe('linkedIssues', () => {
  it('reads every closing keyword GitHub accepts, in any case, with or without a colon', () => {
    assert.deepEqual(linkedIssues('Closes #1, fixes #2\nResolved: #3 and refs #4; Fixed #5 close #6'), [1, 2, 3, 4, 5, 6]);
  });

  it('ignores links inside HTML comments and bare numbers', () => {
    assert.deepEqual(linkedIssues('<!-- Closes #99 -->\nSee #7 and Closes #8'), [8]);
  });

  it('is empty for no body', () => {
    assert.deepEqual(linkedIssues(undefined), []);
  });
});

describe('branchIssue', () => {
  it('reads the trailing number of a conforming branch, and null otherwise', () => {
    assert.equal(branchIssue('fix/thing-12'), 12);
    assert.equal(branchIssue('fix/thing'), null);
    assert.equal(branchIssue('nope/thing-12'), null);
  });

  it('reads a description that ends in a number as an issue, as documented', () => {
    assert.equal(branchIssue('chore/node-24'), 24);
  });
});

describe('check', () => {
  const ok = { branch: 'fix/thing-12', body: 'Closes #12', labels: [], author: 'someone' };

  it('passes a conforming pull request', () => {
    assert.deepEqual(check(ok), []);
  });

  it('refuses a non-conforming branch and still asks for the issue', () => {
    const problems = check({ ...ok, branch: 'claude/thing-12' });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /does not match/);
  });

  it('asks for the issue number on the branch and the link in the body', () => {
    const problems = check({ branch: 'fix/thing', body: 'words', labels: [], author: 'x' });
    assert.equal(problems.length, 2);
    assert.match(problems[0], /names no issue/);
    assert.match(problems[1], /links no issue/);
  });

  it('asks for the branch issue to be among the linked ones', () => {
    const [problem] = check({ ...ok, body: 'Closes #13' });
    assert.match(problem, /names #12, but the description links #13/);
  });

  it('accepts extra links as long as the branch issue is among them', () => {
    assert.deepEqual(check({ ...ok, body: 'Closes #13, refs #12' }), []);
  });

  it('exempts the no-issue label from the issue rules but not from the branch pattern', () => {
    assert.deepEqual(check({ branch: 'docs/typo', body: '', labels: ['no-issue'], author: 'x' }), []);
    assert.equal(check({ branch: 'typo', body: '', labels: ['no-issue'], author: 'x' }).length, 1);
  });

  it('exempts the configured authors entirely', () => {
    assert.deepEqual(check({ branch: 'dependabot/npm_and_yarn/x-1.2.3', body: '', labels: [], author: 'dependabot[bot]' }), []);
    assert.deepEqual(check({ branch: 'renovate/x', body: '', labels: [], author: 'renovate[bot]' }, { exemptAuthors: ['renovate[bot]'] }), []);
  });

  it('honours a caller-provided type list and label', () => {
    assert.deepEqual(check({ branch: 'feat/x-1', body: 'Refs #1', labels: [], author: 'x' }, { types: ['feat'] }), []);
    assert.deepEqual(check({ branch: 'fix/x', body: '', labels: ['trivial'], author: 'x' }, { noIssueLabel: 'trivial' }), []);
  });
});

describe('fromEnv and run', () => {
  it('reads the request and the rules from the environment, with defaults', () => {
    const { request, rules } = fromEnv({ PR_BRANCH: 'fix/x-1', PR_BODY: 'Closes #1', PR_LABELS: '["ui"]', PR_AUTHOR: 'me' });
    assert.deepEqual(request, { branch: 'fix/x-1', body: 'Closes #1', labels: ['ui'], author: 'me' });
    assert.deepEqual(rules.types, ['feature', 'fix', 'refactor', 'docs', 'ci', 'chore']);
    assert.equal(rules.noIssueLabel, 'no-issue');
    assert.deepEqual(rules.exemptAuthors, ['dependabot[bot]']);
  });

  it('treats an unreadable label list as no labels', () => {
    assert.deepEqual(fromEnv({ PR_LABELS: 'not json' }).request.labels, []);
  });

  it('parses comma lists and trims them', () => {
    const { rules } = fromEnv({ PR_TYPES: ' feat, fix ', PR_EXEMPT_AUTHORS: 'a[bot], b[bot]', PR_NO_ISSUE_LABEL: ' trivial ' });
    assert.deepEqual(rules.types, ['feat', 'fix']);
    assert.deepEqual(rules.exemptAuthors, ['a[bot]', 'b[bot]']);
    assert.equal(rules.noIssueLabel, 'trivial');
  });

  it('prints one escaped annotation per problem and exits 1', () => {
    const { lines, code } = run({ PR_BRANCH: 'bad\nname', PR_BODY: '', PR_LABELS: '[]', PR_AUTHOR: 'x' });
    assert.equal(code, 1);
    assert.ok(lines.every((l) => l.startsWith('::error::') && !l.includes('\n')));
    assert.match(lines[0], /bad%0Aname/);
  });

  it('exits 0 with one line when it passes', () => {
    assert.deepEqual(run({ PR_BRANCH: 'fix/x-1', PR_BODY: 'Closes #1', PR_LABELS: '[]', PR_AUTHOR: 'x' }), {
      lines: ['Branch and issue link follow the convention.'],
      code: 0,
    });
  });
});

describe('escapeCommand', () => {
  it('escapes the three characters the runner would read as syntax', () => {
    assert.equal(escapeCommand('a%b\r\nc'), 'a%25b%0D%0Ac');
  });
});
