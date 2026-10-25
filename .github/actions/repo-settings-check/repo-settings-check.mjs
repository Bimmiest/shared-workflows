#!/usr/bin/env node
/**
 * Whether a repository has the settings that the repo-template checklist
 * sets (#16). A template copies files, not settings, so a setting drifts with
 * no commit and no review: on 2026-10-25 two repositories still had the wiki
 * on against the documentation standard, and nothing noticed.
 *
 *   node repo-settings-check.mjs [--repo owner/name] [--config .repo-settings.json]
 *
 * The token is `GH_TOKEN`. Most of these endpoints answer only a token with
 * "Administration: read", which no GITHUB_TOKEN can hold, so the caller
 * passes a fine-grained token. A setting that the token cannot read fails:
 * a check that cannot see the answer has verified nothing.
 *
 * The optional config:
 *
 *   { "requiredChecks": ["verify", "audit"],
 *     "exceptions": [ { "setting": "main.pull-request", "reason": "…" } ] }
 *
 * `requiredChecks` are the names that the `main` ruleset must require. An
 * exception names a setting from SETTINGS, with the reason. An exception for
 * a setting that is correct fails, so the file cannot rot.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

/** Each endpoint the settings are read from, by the name that SETTINGS uses. */
export const SOURCES = {
  repository: '',
  actions: '/actions/permissions',
  workflow: '/actions/permissions/workflow',
  fork: '/actions/permissions/fork-pr-contributor-approval',
  reporting: '/private-vulnerability-reporting',
  alerts: '/vulnerability-alerts',
  rules: '/rules/branches/main',
};

const hasRule = (type) => (rules) => rules.some((rule) => rule.type === type);
const requiredContexts = (rules) =>
  rules.filter((rule) => rule.type === 'required_status_checks').flatMap((rule) => rule.parameters?.required_status_checks?.map((check) => check.context) ?? []);

/**
 * Each setting the template sets, with the source it is read from, a test,
 * and what to change. A test returns true when the setting is correct, false
 * when it is not, undefined when the source does not say, and a string for a
 * finding with detail.
 */
export const SETTINGS = {
  'merge.squash-only': {
    source: 'repository',
    test: (r) => (r.allow_squash_merge === undefined ? undefined : r.allow_squash_merge === true && r.allow_merge_commit === false && r.allow_rebase_merge === false),
    fix: 'Allow squash merges only, in Settings, General, Pull requests.',
  },
  'merge.squash-body': {
    source: 'repository',
    test: (r) => (r.squash_merge_commit_message === undefined ? undefined : r.squash_merge_commit_title === 'COMMIT_OR_PR_TITLE' && r.squash_merge_commit_message === 'COMMIT_MESSAGES'),
    fix: 'Make the default squash commit the commit title and the commit messages of the branch.',
  },
  'merge.delete-branch': {
    source: 'repository',
    test: (r) => (r.delete_branch_on_merge === undefined ? undefined : r.delete_branch_on_merge === true),
    fix: 'Delete the head branch after a merge.',
  },
  'wiki.off': {
    source: 'repository',
    test: (r) => (r.has_wiki === undefined ? undefined : r.has_wiki === false),
    fix: 'Turn off the wiki. Detail goes in docs/, where it gets a review and a link check.',
  },
  'security.secret-scanning': {
    source: 'repository',
    test: (r) => (r.security_and_analysis?.secret_scanning ? r.security_and_analysis.secret_scanning.status === 'enabled' : undefined),
    fix: 'Turn on secret scanning, in Settings, Advanced Security.',
  },
  'security.push-protection': {
    source: 'repository',
    test: (r) => (r.security_and_analysis?.secret_scanning_push_protection ? r.security_and_analysis.secret_scanning_push_protection.status === 'enabled' : undefined),
    fix: 'Turn on push protection for secret scanning, in Settings, Advanced Security.',
  },
  'security.private-vulnerability-reporting': {
    source: 'reporting',
    test: (p) => p.enabled === true,
    fix: 'Turn on private vulnerability reporting, in Settings, Advanced Security.',
  },
  'security.dependabot-alerts': {
    source: 'alerts',
    test: (enabled) => enabled,
    fix: 'Turn on Dependabot alerts, in Settings, Advanced Security.',
  },
  'actions.sha-pinning': {
    source: 'actions',
    test: (a) => a.sha_pinning_required === true,
    fix: 'Require actions to be pinned to a full-length commit SHA, in Settings, Actions, General.',
  },
  'actions.read-only-token': {
    source: 'workflow',
    test: (w) => w.default_workflow_permissions === 'read',
    fix: 'Make the default workflow permissions read-only, in Settings, Actions, General.',
  },
  'actions.no-pr-approval': {
    source: 'workflow',
    test: (w) => w.can_approve_pull_request_reviews === false,
    fix: 'Do not let GitHub Actions create or approve pull requests, in Settings, Actions, General.',
  },
  'actions.fork-approval': {
    source: 'fork',
    test: (f) => f.approval_policy === 'all_external_contributors',
    fix: 'Require approval for the workflows of all external contributors, in Settings, Actions, General.',
  },
  'main.pull-request': {
    source: 'rules',
    test: hasRule('pull_request'),
    fix: 'Require a pull request before a merge to main, in a ruleset.',
  },
  'main.no-force-push': {
    source: 'rules',
    test: hasRule('non_fast_forward'),
    fix: 'Block force pushes to main, in a ruleset.',
  },
  'main.no-deletion': {
    source: 'rules',
    test: hasRule('deletion'),
    fix: 'Block the deletion of main, in a ruleset.',
  },
  'main.required-checks': {
    source: 'rules',
    test: (rules, config) => {
      const required = requiredContexts(rules);
      const missing = (config.requiredChecks ?? []).filter((name) => !required.includes(name));
      if (missing.length) return `main does not require ${missing.map((name) => `\`${name}\``).join(', ')}.`;
      return required.length > 0;
    },
    fix: 'Require the status checks by name, in the ruleset for main.',
  },
};

/** The answer of one endpoint, read through `get(path)`, which resolves to `{ status, body }`. */
async function read(get, source) {
  const { status, body } = await get(SOURCES[source]);
  // GitHub's own reason, which tells a missing permission from a plan that
  // does not offer the setting ("Upgrade to GitHub Pro or make this
  // repository public").
  const reason = [body?.message, typeof body?.errors === 'string' ? body.errors : null].filter(Boolean).join(': ');
  const failed = { ok: false, status, ...(reason ? { reason } : {}) };
  if (source === 'alerts') return status === 204 ? { ok: true, value: true } : status === 404 ? { ok: true, value: false } : failed;
  return status === 200 ? { ok: true, value: body } : failed;
}

/** What to do about a setting that cannot be read. */
const UNREADABLE = 'Give the token "Administration: read", or, if the plan does not offer the setting on this repository, add an exception with the reason.';

/** Each source, read once. */
export async function readState(get) {
  const entries = await Promise.all(Object.keys(SOURCES).map(async (source) => [source, await read(get, source)]));
  return Object.fromEntries(entries);
}

/** What the config is wrong about, as sentences. */
function configProblems(config, file) {
  const out = [];
  if (config.requiredChecks !== undefined && (!Array.isArray(config.requiredChecks) || !config.requiredChecks.every((name) => typeof name === 'string'))) {
    out.push(`${file} requiredChecks must be a list of check names.`);
  }
  for (const [index, entry] of (config.exceptions ?? []).entries()) {
    if (!SETTINGS[entry?.setting]) out.push(`${file} exception ${index + 1} names \`${entry?.setting}\`, which is not a setting. The settings are ${Object.keys(SETTINGS).join(', ')}.`);
    else if (typeof entry.reason !== 'string' || !entry.reason.trim()) out.push(`${file} exception for \`${entry.setting}\` has no reason.`);
  }
  return out;
}

/** The verdict on one state against the config, as lines and an exit code. */
export function check(state, config = {}, { file = '.repo-settings.json' } = {}) {
  const lines = configProblems(config, file).map((problem) => `::error::${problem}`);
  if (lines.length) return { lines, code: 1 };
  const excepted = new Map((config.exceptions ?? []).map((entry) => [entry.setting, entry.reason]));
  let correct = 0;
  for (const [id, { source, test, fix }] of Object.entries(SETTINGS)) {
    const answer = state[source];
    let finding;
    if (!answer.ok) {
      finding = `${id} could not be read: ${SOURCES[source] || '/'} answered HTTP ${answer.status}${answer.reason ? ` (${answer.reason})` : ''}. ${UNREADABLE}`;
    } else {
      const verdict = test(answer.value, config);
      if (verdict === true) finding = null;
      else if (verdict === undefined) finding = `${id} could not be read: the answer has no value for it. ${UNREADABLE}`;
      else finding = `${id} is wrong. ${typeof verdict === 'string' ? `${verdict} ` : ''}${fix}`;
    }
    if (excepted.has(id)) {
      if (finding === null) lines.push(`::error::${file} excepts \`${id}\`, which is correct now. Remove the exception.`);
    } else if (finding === null) correct += 1;
    else lines.push(`::error::${finding}`);
  }
  if (lines.length) return { lines, code: 1 };
  return { lines: [`${correct} settings match the template${excepted.size ? `, and ${excepted.size} are excepted in ${file}` : ''}.`], code: 0 };
}

async function main() {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string', default: process.env.GITHUB_REPOSITORY ?? '' },
      config: { type: 'string', default: '.repo-settings.json' },
    },
  });
  const token = process.env.GH_TOKEN;
  if (!values.repo) {
    console.log('::error::No repository. Pass --repo owner/name, or run in GitHub Actions.');
    return 1;
  }
  if (!token) {
    console.log('::error::No token in GH_TOKEN. Pass a fine-grained token with "Administration: read" on this repository.');
    return 1;
  }
  const api = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  const get = async (suffix) => {
    const response = await fetch(`${api}/repos/${values.repo}${suffix}`, {
      headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', authorization: `Bearer ${token}` },
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json().catch(() => null) };
  };
  const config = existsSync(values.config) ? JSON.parse(readFileSync(values.config, 'utf8')) : {};
  const { lines, code } = check(await readState(get), config, { file: values.config });
  for (const line of lines) console.log(line);
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href) {
  process.exitCode = await main();
}
