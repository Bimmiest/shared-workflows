import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { FORMS, SETTINGS, SOURCES, check, formLabels, readForms, readState, tagRef, wantedLabels } from './repo-settings-check.mjs';

const UNREADABLE = 'Give the token "Administration: read", or, if the plan does not offer the setting on this repository, add an exception with the reason.';

/** The answers of a repository that matches the template, as readState returns them. */
const good = () => ({
  merge: {
    ok: true,
    value: {
      squashMergeAllowed: true,
      mergeCommitAllowed: false,
      rebaseMergeAllowed: false,
      squashMergeCommitTitle: 'COMMIT_OR_PR_TITLE',
      squashMergeCommitMessage: 'COMMIT_MESSAGES',
      deleteBranchOnMerge: true,
    },
  },
  repository: {
    ok: true,
    value: {
      has_wiki: false,
      security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } },
    },
  },
  actions: { ok: true, value: { sha_pinning_required: true } },
  workflow: { ok: true, value: { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false } },
  fork: { ok: true, value: { approval_policy: 'all_external_contributors' } },
  reporting: { ok: true, value: { enabled: true } },
  alerts: { ok: true, value: true },
  rules: {
    ok: true,
    value: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      { type: 'pull_request' },
      { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'verify' }, { context: 'audit' }] } },
    ],
  },
  tags: { ok: true, value: [releaseTags()] },
  labels: { ok: true, value: [{ name: 'bug' }, { name: 'no-issue' }, { name: 'Decision' }] },
});

/** A tag ruleset as GET /rulesets/{id} gives it, which blocks each change to the tags of `v*`. */
const releaseTags = (changes = {}) => ({
  id: 7,
  name: 'release tags',
  target: 'tag',
  enforcement: 'active',
  conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } },
  rules: [{ type: 'deletion' }, { type: 'update' }, { type: 'non_fast_forward' }],
  ...changes,
});

/** The number of settings that apply when the config sets no tagRuleset and no form or config names a label. */
const withoutTags = Object.keys(SETTINGS).filter((id) => !id.startsWith('tags.') && !id.startsWith('labels.')).length;

const UNLABELLED = 'Create the label (repo-template docs/repository-settings.md has the commands), or remove it from the file.';

describe('check', () => {
  it('passes a repository that matches the template', () => {
    const { code, lines } = check(good(), { requiredChecks: ['verify', 'audit'], tagRuleset: 'v*', labels: ['no-issue'] });
    assert.equal(code, 0, lines.join('\n'));
    assert.deepEqual(lines, [`${Object.keys(SETTINGS).length} settings match the template.`]);
  });

  it('does not judge the tag rulesets when the config does not set tagRuleset', () => {
    const state = good();
    delete state.tags;
    assert.deepEqual(check(state).lines, [`${withoutTags} settings match the template.`]);
  });

  it('names each missing label, and each file that asks for it', () => {
    const forms = { [`${FORMS}/bug.yml`]: ['bug'], [`${FORMS}/tech-debt.yml`]: ['tech-debt'], [`${FORMS}/question.yml`]: ['question', 'no-changelog'] };
    const { code, lines } = check(good(), { labels: ['no-issue', 'no-changelog'] }, { forms });
    assert.equal(code, 1);
    assert.deepEqual(lines, [
      `::error::labels.exist is wrong. The label \`tech-debt\` does not exist, and ${FORMS}/tech-debt.yml asks for it. ${UNLABELLED}`,
      `::error::labels.exist is wrong. The label \`question\` does not exist, and ${FORMS}/question.yml asks for it. ${UNLABELLED}`,
      `::error::labels.exist is wrong. The label \`no-changelog\` does not exist, and ${FORMS}/question.yml and .repo-settings.json ask for it. ${UNLABELLED}`,
    ]);
  });

  it('finds a label without regard to case, as GitHub does', () => {
    const { code, lines } = check(good(), { labels: ['decision', 'NO-ISSUE'] }, { forms: { [`${FORMS}/bug.yml`]: ['Bug'] } });
    assert.equal(code, 0, lines.join('\n'));
    assert.deepEqual(lines, [`${withoutTags + 1} settings match the template.`]);
  });

  it('fails when the labels cannot be read, and names the permission', () => {
    const state = { ...good(), labels: { ok: false, status: 404, reason: 'Not Found' } };
    assert.deepEqual(check(state, { labels: ['no-issue'] }).lines, [
      '::error::labels.exist could not be read: /labels?per_page=100 answered HTTP 404 (Not Found). Give the token "Issues: read", which the labels of a private repository need.',
    ]);
  });

  it('refuses a labels key that is not a list of names, and a form whose labels it cannot read', () => {
    for (const labels of ['no-issue', [''], [1], {}]) {
      assert.deepEqual(check(good(), { labels }).lines, ['::error::.repo-settings.json labels must be a list of label names.'], JSON.stringify(labels));
    }
    assert.deepEqual(check(good(), {}, { forms: { [`${FORMS}/bug.yml`]: null } }).lines, [
      `::error::${FORMS}/bug.yml labels could not be read. Write them as a list on one line, for example \`labels: [bug]\`.`,
    ]);
  });

  it('refuses an exception for the labels when nothing asks for a label', () => {
    assert.deepEqual(check(good(), { exceptions: [{ setting: 'labels.exist', reason: 'No labels.' }] }, { forms: { [`${FORMS}/blank.yml`]: [] } }).lines, [
      '::error::.repo-settings.json excepts `labels.exist`, which this config does not check. Remove the exception.',
    ]);
  });

  it('names each wrong setting and what to change', () => {
    const state = good();
    state.repository.value.has_wiki = true;
    state.merge.value.rebaseMergeAllowed = true;
    state.workflow.value.default_workflow_permissions = 'write';
    state.alerts.value = false;
    state.rules.value = state.rules.value.filter((rule) => rule.type !== 'non_fast_forward');
    const { code, lines } = check(state);
    assert.equal(code, 1);
    assert.deepEqual(lines, [
      '::error::merge.squash-only is wrong. Allow squash merges only, in Settings, General, Pull requests.',
      '::error::wiki.off is wrong. Turn off the wiki. Detail goes in docs/, where it gets a review and a link check.',
      '::error::security.dependabot-alerts is wrong. Turn on Dependabot alerts, in Settings, Advanced Security.',
      '::error::actions.read-only-token is wrong. Make the default workflow permissions read-only, in Settings, Actions, General.',
      '::error::main.no-force-push is wrong. Block force pushes to main, in a ruleset.',
    ]);
  });

  it('names each required check that main does not require', () => {
    const { lines } = check(good(), { requiredChecks: ['verify', 'pr-hygiene', 'security / trivy'] });
    assert.deepEqual(lines, ['::error::main.required-checks is wrong. main does not require `pr-hygiene`, `security / trivy`. Require the status checks by name, in the ruleset for main.']);
  });

  it('fails a ruleset that requires no check, when the config names none', () => {
    const state = good();
    state.rules.value = state.rules.value.filter((rule) => rule.type !== 'required_status_checks');
    assert.match(check(state).lines[0], /^::error::main\.required-checks is wrong\. Require/);
  });

  it('fails a setting that the token cannot read, and says which permission is missing', () => {
    const state = good();
    // What GET /repos answers a token without admin access: no security_and_analysis.
    state.repository.value = { has_wiki: false };
    // What GraphQL answers for a field that the token cannot read.
    state.merge.value.deleteBranchOnMerge = null;
    state.rules = { ok: false, status: 403, reason: 'Upgrade to GitHub Pro or make this repository public to enable this feature.' };
    const { code, lines } = check(state);
    assert.equal(code, 1);
    assert.ok(lines.includes(`::error::security.secret-scanning could not be read: the answer has no value for it. ${UNREADABLE}`));
    assert.ok(lines.includes(`::error::merge.delete-branch could not be read: the answer has no value for it. ${UNREADABLE}`));
    assert.ok(lines.includes(`::error::main.pull-request could not be read: /rules/branches/main answered HTTP 403 (Upgrade to GitHub Pro or make this repository public to enable this feature.). ${UNREADABLE}`));
    assert.ok(!lines.some((line) => line.includes('wiki.off') || line.includes('merge.squash-only')), 'a setting that it can read is still judged');
  });

  it('accepts an exception with a reason, and fails one that nothing needs', () => {
    const state = good();
    state.rules = { ok: false, status: 403 };
    const exceptions = ['main.pull-request', 'main.no-force-push', 'main.no-deletion', 'main.required-checks'].map((setting) => ({
      setting,
      reason: 'GitHub refuses rulesets on a private repository on the Free plan.',
    }));
    assert.deepEqual(check(state, { exceptions }).lines, [`${withoutTags - 4} settings match the template, and 4 are excepted in .repo-settings.json.`]);
    const stale = check(good(), { exceptions: [{ setting: 'wiki.off', reason: 'The wiki was on.' }] });
    assert.equal(stale.code, 1);
    assert.deepEqual(stale.lines, ['::error::.repo-settings.json excepts `wiki.off`, which is correct now. Remove the exception.']);
  });

  it('accepts the pattern with or without refs/tags/', () => {
    assert.equal(tagRef('v*'), 'refs/tags/v*');
    assert.equal(tagRef('refs/tags/v*'), 'refs/tags/v*');
    assert.equal(check(good(), { tagRuleset: 'refs/tags/v*' }).code, 0);
  });

  it('accepts a ruleset on all tags, and rules from two rulesets on the pattern', () => {
    const state = good();
    state.tags.value = [releaseTags({ conditions: { ref_name: { include: ['~ALL'], exclude: [] } } })];
    assert.equal(check(state, { tagRuleset: 'v*' }).code, 0);
    state.tags.value = [releaseTags({ rules: [{ type: 'update' }] }), releaseTags({ id: 8, name: 'no deletion', rules: [{ type: 'deletion' }] })];
    assert.equal(check(state, { tagRuleset: 'v*' }).code, 0);
  });

  it('fails when no tag ruleset exists', () => {
    const state = good();
    state.tags.value = [];
    assert.deepEqual(check(state, { tagRuleset: 'v*' }).lines, [
      '::error::tags.no-update is wrong. No active tag ruleset on `refs/tags/v*` blocks updates. Restrict updates in an active tag ruleset that targets the `tagRuleset` pattern with no exclusion, in Settings, Rules.',
      '::error::tags.no-deletion is wrong. No active tag ruleset on `refs/tags/v*` blocks deletions. Restrict deletions in an active tag ruleset that targets the `tagRuleset` pattern with no exclusion, in Settings, Rules.',
    ]);
  });

  it('fails a tag ruleset that blocks only deletion', () => {
    const state = good();
    state.tags.value = [releaseTags({ rules: [{ type: 'deletion' }] })];
    const { code, lines } = check(state, { tagRuleset: 'v*' });
    assert.equal(code, 1);
    assert.deepEqual(lines, [
      '::error::tags.no-update is wrong. No active tag ruleset on `refs/tags/v*` blocks updates. Restrict updates in an active tag ruleset that targets the `tagRuleset` pattern with no exclusion, in Settings, Rules.',
    ]);
  });

  for (const enforcement of ['evaluate', 'disabled']) {
    it(`fails a tag ruleset in ${enforcement} mode, and names it`, () => {
      const state = good();
      state.tags.value = [releaseTags({ enforcement })];
      const { lines } = check(state, { tagRuleset: 'v*' });
      assert.equal(lines.length, 2);
      assert.ok(lines[0].startsWith(`::error::tags.no-update is wrong. No active tag ruleset on \`refs/tags/v*\` blocks updates: \`release tags\` is \`${enforcement}\`. Restrict`), lines[0]);
    });
  }

  it('fails a tag ruleset on another pattern, with an exclusion, or on branches', () => {
    for (const ruleset of [
      releaseTags({ conditions: { ref_name: { include: ['refs/tags/release-*'], exclude: [] } } }),
      releaseTags({ conditions: { ref_name: { include: ['~ALL'], exclude: ['refs/tags/v0*'] } } }),
      releaseTags({ conditions: undefined }),
      releaseTags({ target: 'branch' }),
    ]) {
      const state = good();
      state.tags.value = [ruleset];
      assert.equal(check(state, { tagRuleset: 'v*' }).lines.length, 2, JSON.stringify(ruleset));
    }
  });

  it('refuses a tagRuleset that is not a pattern, and an exception for a tag setting that the config does not ask for', () => {
    for (const tagRuleset of ['', ' ', 1, ['v*']]) {
      assert.deepEqual(check(good(), { tagRuleset }).lines, ['::error::.repo-settings.json tagRuleset must be the pattern of the release tags, for example "v*".']);
    }
    assert.deepEqual(check(good(), { exceptions: [{ setting: 'tags.no-update', reason: 'Not released by tag.' }] }).lines, [
      '::error::.repo-settings.json excepts `tags.no-update`, which this config does not check. Remove the exception.',
    ]);
  });

  it('refuses a config that names no real setting, gives no reason, or lists checks wrongly', () => {
    assert.match(check(good(), { exceptions: [{ setting: 'wiki', reason: 'x' }] }).lines[0], /names `wiki`, which is not a setting\. The settings are merge\.squash-only, /);
    assert.deepEqual(check(good(), { exceptions: [{ setting: 'wiki.off' }] }).lines, ['::error::.repo-settings.json exception for `wiki.off` has no reason.']);
    assert.deepEqual(check(good(), { requiredChecks: 'verify' }).lines, ['::error::.repo-settings.json requiredChecks must be a list of check names.']);
  });
});

describe('readState', () => {
  const answering = (answers) => async (suffix) => answers[suffix] ?? { status: 200, body: {} };

  it('reads each source once, and Dependabot alerts from the status code', async () => {
    const asked = [];
    const state = await readState(async (suffix) => {
      asked.push(suffix);
      if (suffix === SOURCES.merge) return { status: 200, body: { data: { repository: { deleteBranchOnMerge: true } } } };
      return suffix === SOURCES.alerts ? { status: 204, body: null } : { status: 200, body: { suffix } };
    });
    assert.deepEqual(
      asked.sort(),
      Object.values(SOURCES)
        .filter((suffix) => suffix !== SOURCES.tags && suffix !== SOURCES.labels)
        .sort(),
      'no tag rulesets without tagRuleset, and no labels when nothing asks for one',
    );
    assert.deepEqual(state.merge, { ok: true, value: { deleteBranchOnMerge: true } });
    assert.deepEqual(state.alerts, { ok: true, value: true });
    assert.deepEqual(state.rules, { ok: true, value: { suffix: '/rules/branches/main' } });
  });

  it('reads 404 as alerts off, and any other failure as unreadable', async () => {
    assert.deepEqual((await readState(answering({ [SOURCES.alerts]: { status: 404 } }))).alerts, { ok: true, value: false });
    assert.deepEqual((await readState(answering({ [SOURCES.alerts]: { status: 403 } }))).alerts, { ok: false, status: 403 });
    assert.deepEqual((await readState(answering({ [SOURCES.fork]: { status: 403 } }))).fork, { ok: false, status: 403 });
    const refused = { status: 422, body: { message: 'Validation Failed', errors: 'Fork PR approval is not allowed for private repositories.' } };
    assert.deepEqual((await readState(answering({ [SOURCES.fork]: refused }))).fork, { ok: false, status: 422, reason: 'Validation Failed: Fork PR approval is not allowed for private repositories.' });
  });

  it('lists the rulesets, then reads each tag ruleset by id, because the list has no rules', async () => {
    const list = [
      { id: 1, name: 'main', target: 'branch', enforcement: 'active' },
      { id: 7, name: 'release tags', target: 'tag', enforcement: 'active' },
    ];
    const asked = [];
    const state = await readState(
      async (suffix) => {
        asked.push(suffix);
        if (suffix === SOURCES.tags) return { status: 200, body: list };
        if (suffix === '/rulesets/7') return { status: 200, body: releaseTags() };
        return { status: 200, body: {} };
      },
      { tagRuleset: 'v*' },
    );
    assert.ok(asked.includes(SOURCES.tags));
    assert.ok(!asked.includes('/rulesets/1'), 'a branch ruleset is not read');
    assert.deepEqual(state.tags, { ok: true, value: [releaseTags()] });
    assert.deepEqual((await readState(answering({ [SOURCES.tags]: { status: 200, body: null } }), { tagRuleset: 'v*' })).tags, { ok: true, value: [] });
  });

  it('reads a tag ruleset that the token cannot read as unreadable, and names its path', async () => {
    const answers = { [SOURCES.tags]: { status: 200, body: [{ id: 7, target: 'tag' }] }, '/rulesets/7': { status: 404, body: { message: 'Not Found' } } };
    const state = await readState(answering(answers), { tagRuleset: 'v*' });
    assert.deepEqual(state.tags, { ok: false, status: 404, reason: 'Not Found', path: '/rulesets/7' });
    const { lines } = check({ ...good(), tags: state.tags }, { tagRuleset: 'v*' });
    assert.equal(lines[0], `::error::tags.no-update could not be read: /rulesets/7 answered HTTP 404 (Not Found). ${UNREADABLE}`);
    const refused = await readState(answering({ [SOURCES.tags]: { status: 403, body: { message: 'Resource not accessible' } } }), { tagRuleset: 'v*' });
    assert.deepEqual(refused.tags, { ok: false, status: 403, reason: 'Resource not accessible' });
  });

  it('reads a GraphQL answer with no repository as unreadable, with the reason', async () => {
    const missing = { status: 200, body: { data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: "Could not resolve to a Repository with the name 'o/r'." }] } };
    assert.deepEqual((await readState(answering({ [SOURCES.merge]: missing }))).merge, { ok: false, status: 200, reason: "Could not resolve to a Repository with the name 'o/r'." });
    const refused = { status: 401, body: { message: 'Bad credentials' } };
    assert.deepEqual((await readState(answering({ [SOURCES.merge]: refused }))).merge, { ok: false, status: 401, reason: 'Bad credentials' });
  });
});

describe('the labels', () => {
  const names = (from, count) => Array.from({ length: count }, (_, index) => ({ name: `label-${from + index}` }));

  it('reads each page of 100, until a page that is not full', async () => {
    const pages = { [SOURCES.labels]: names(0, 100), [`${SOURCES.labels}&page=2`]: names(100, 100), [`${SOURCES.labels}&page=3`]: names(200, 3) };
    const asked = [];
    const state = await readState(
      async (suffix) => {
        asked.push(suffix);
        return pages[suffix] ? { status: 200, body: pages[suffix] } : { status: 200, body: {} };
      },
      { labels: ['label-202'] },
    );
    assert.equal(state.labels.value.length, 203);
    assert.deepEqual(
      asked.filter((suffix) => suffix.startsWith('/labels')),
      [SOURCES.labels, `${SOURCES.labels}&page=2`, `${SOURCES.labels}&page=3`],
    );
    assert.equal(check({ ...good(), labels: state.labels }, { labels: ['label-202'] }).code, 0);
  });

  it('stops at an empty page, and names the page that it cannot read', async () => {
    const full = async (suffix) => (suffix === SOURCES.labels ? { status: 200, body: names(0, 100) } : { status: 200, body: [] });
    assert.equal((await readState(full, { labels: ['x'] })).labels.value.length, 100);
    const refused = async (suffix) => (suffix === SOURCES.labels ? { status: 200, body: names(0, 100) } : { status: 502, body: { message: 'Bad Gateway' } });
    assert.deepEqual((await readState(refused, { labels: ['x'] })).labels, { ok: false, status: 502, reason: 'Bad Gateway', path: `${SOURCES.labels}&page=2` });
  });

  it('reads the labels when only a form names one', async () => {
    const asked = [];
    await readState(
      async (suffix) => {
        asked.push(suffix);
        return { status: 200, body: [] };
      },
      {},
      { forms: { [`${FORMS}/bug.yml`]: ['bug'] } },
    );
    assert.ok(asked.includes(SOURCES.labels));
  });

  it('merges the forms and the config into one entry for each label', () => {
    assert.deepEqual(wantedLabels({ labels: ['no-issue', 'Bug', 3] }, { 'a.yml': ['bug'], 'b.yml': ['bug', 'bug'], 'c.yml': null }, 'x.json'), [
      { name: 'bug', files: ['a.yml', 'b.yml', 'x.json'] },
      { name: 'no-issue', files: ['x.json'] },
    ]);
  });
});

describe('formLabels', () => {
  it('reads a flow list, a string with commas, and a block list, with quotes and comments', () => {
    assert.deepEqual(formLabels('name: Bug\nlabels: [bug, "needs triage"] # why\nbody:\n'), ['bug', 'needs triage']);
    assert.deepEqual(formLabels("labels: 'bug, triage'\n"), ['bug', 'triage']);
    assert.deepEqual(formLabels('labels: bug\n'), ['bug']);
    assert.deepEqual(formLabels('labels:\n  - bug\n\n  # a comment\n  - "tech-debt" # why\nbody:\n  - type: textarea\n'), ['bug', 'tech-debt']);
    assert.deepEqual(formLabels('labels:\r\n- bug\r\nbody:\r\n'), ['bug']);
    assert.deepEqual(formLabels('labels: []\n'), []);
  });

  it('gives no labels for a form with no top-level labels key', () => {
    assert.deepEqual(formLabels('name: Bug\nbody:\n  - type: input\n    labels: [not, this]\n'), []);
  });

  it('gives null for a form that it cannot read, so the check fails and does not pass with no labels', () => {
    assert.equal(formLabels('labels: [bug,\n  triage]\n'), null);
    assert.equal(formLabels('labels: >\n  bug\n'), null);
    assert.equal(formLabels('labels: *common\n'), null);
  });
});

describe('readForms', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'repo-settings-forms-'));
  after(() => rmSync(root, { recursive: true, force: true }));

  it('reads each form in the forms directory, and not config.yml or a Markdown template', () => {
    assert.deepEqual(readForms(root), {}, 'no forms directory');
    mkdirSync(path.join(root, FORMS), { recursive: true });
    writeFileSync(path.join(root, FORMS, 'tech-debt.yml'), 'labels: [tech-debt]\n');
    writeFileSync(path.join(root, FORMS, 'bug.yaml'), 'labels:\n  - bug\n');
    writeFileSync(path.join(root, FORMS, 'config.yml'), 'blank_issues_enabled: false\n');
    writeFileSync(path.join(root, FORMS, 'old.md'), '---\nlabels: old\n---\n');
    assert.deepEqual(readForms(root), { [`${FORMS}/bug.yaml`]: ['bug'], [`${FORMS}/tech-debt.yml`]: ['tech-debt'] });
  });
});
