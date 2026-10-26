import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SETTINGS, SOURCES, check, readState } from './repo-settings-check.mjs';

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
});

describe('check', () => {
  it('passes a repository that matches the template', () => {
    const { code, lines } = check(good(), { requiredChecks: ['verify', 'audit'] });
    assert.equal(code, 0, lines.join('\n'));
    assert.deepEqual(lines, [`${Object.keys(SETTINGS).length} settings match the template.`]);
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
    assert.deepEqual(check(state, { exceptions }).lines, [`${Object.keys(SETTINGS).length - 4} settings match the template, and 4 are excepted in .repo-settings.json.`]);
    const stale = check(good(), { exceptions: [{ setting: 'wiki.off', reason: 'The wiki was on.' }] });
    assert.equal(stale.code, 1);
    assert.deepEqual(stale.lines, ['::error::.repo-settings.json excepts `wiki.off`, which is correct now. Remove the exception.']);
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
    assert.deepEqual(asked.sort(), Object.values(SOURCES).sort());
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

  it('reads a GraphQL answer with no repository as unreadable, with the reason', async () => {
    const missing = { status: 200, body: { data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: "Could not resolve to a Repository with the name 'o/r'." }] } };
    assert.deepEqual((await readState(answering({ [SOURCES.merge]: missing }))).merge, { ok: false, status: 200, reason: "Could not resolve to a Repository with the name 'o/r'." });
    const refused = { status: 401, body: { message: 'Bad credentials' } };
    assert.deepEqual((await readState(answering({ [SOURCES.merge]: refused }))).merge, { ok: false, status: 401, reason: 'Bad credentials' });
  });
});
