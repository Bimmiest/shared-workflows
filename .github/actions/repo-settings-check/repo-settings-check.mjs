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
 * passes a fine-grained token. The labels of a private repository also need
 * "Issues: read" on that token. A setting that the token cannot read fails:
 * a check that cannot see the answer has verified nothing.
 *
 * The merge settings come from GraphQL. GET /repos gives them only to a
 * token with "Contents: write", and a settings check must not push (#42).
 *
 * The optional config:
 *
 *   { "requiredChecks": ["verify", "audit"],
 *     "tagRuleset": "v*",
 *     "labels": ["no-issue", "no-changelog"],
 *     "exceptions": [ { "setting": "main.pull-request", "reason": "…" } ] }
 *
 * `requiredChecks` are the names that the `main` ruleset must require.
 * `tagRuleset` is the pattern of the release tags. Only a repository that
 * sets it gets the `tags.*` settings, because a tag ruleset is a choice of
 * the repository, not of the template (#41). `labels` are the labels that
 * the process uses and that no issue form names. Each of them, and each
 * label in the `labels:` of an issue form in `.github/ISSUE_TEMPLATE/`, must
 * exist: a form files its issue without a missing label and says nothing,
 * and nobody can give a pull request an exemption label that is not there
 * (#72). An exception names a setting from SETTINGS, with the reason. An
 * exception for a setting that is correct fails, so the file cannot rot.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

/** Each endpoint the settings are read from, by the name that SETTINGS uses. */
export const SOURCES = {
  repository: '',
  merge: 'GraphQL',
  actions: '/actions/permissions',
  workflow: '/actions/permissions/workflow',
  fork: '/actions/permissions/fork-pr-contributor-approval',
  reporting: '/private-vulnerability-reporting',
  alerts: '/vulnerability-alerts',
  rules: '/rules/branches/main',
  // shortcut: reads the first 100 rulesets only. Follow the Link header when
  // a repository gets near 100 rulesets.
  tags: '/rulesets?targets=tag&per_page=100',
  labels: '/labels?per_page=100',
};

/** The directory of the issue forms, relative to the working directory. */
export const FORMS = '.github/ISSUE_TEMPLATE';

/** A YAML scalar without its quotes. */
const unquote = (text) => text.trim().replace(/^(["'])(.*)\1$/, '$2').trim();

/**
 * The `labels:` of one issue form, or null when this reader cannot read
 * them. GitHub takes a list or a string with commas. This is not a YAML
 * parser, because a script has no dependencies (ADR 0002): it reads the
 * flow list, the block list and the string, on the top-level key only. Each
 * other form fails, rather than giving no labels and a pass.
 */
export function formLabels(text) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((line) => /^labels\s*:/.test(line));
  if (at === -1) return [];
  const value = lines[at].replace(/^labels\s*:/, '').replace(/\s+#.*$/, '').trim();
  const names = (items) => items.map(unquote).filter(Boolean);
  if (value.startsWith('[')) return value.endsWith(']') ? names(value.slice(1, -1).split(',')) : null;
  if (/^[|>&*!]/.test(value)) return null;
  if (value) return names(unquote(value).split(','));
  const items = [];
  for (const line of lines.slice(at + 1)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const item = line.match(/^\s*-\s+(.*?)(\s+#.*)?$/);
    if (!item) break;
    items.push(item[1]);
  }
  return names(items);
}

/** The labels of each issue form under `root`, by the path of the form. */
export function readForms(root = '.') {
  const dir = path.join(root, FORMS);
  if (!existsSync(dir)) return {};
  const files = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name) && name !== 'config.yml' && name !== 'config.yaml').sort();
  return Object.fromEntries(files.map((name) => [`${FORMS}/${name}`, formLabels(readFileSync(path.join(dir, name), 'utf8'))]));
}

/**
 * Each label that the config and the forms ask for, with the files that ask.
 * GitHub holds label names unique without regard to case, so the names are
 * compared that way too.
 */
export function wantedLabels(config = {}, forms = {}, file = '.repo-settings.json') {
  const wanted = new Map();
  const add = (name, from) => {
    const key = name.toLowerCase();
    if (!wanted.has(key)) wanted.set(key, { name, files: [] });
    if (!wanted.get(key).files.includes(from)) wanted.get(key).files.push(from);
  };
  for (const [form, labels] of Object.entries(forms)) for (const name of labels ?? []) add(name, form);
  for (const name of Array.isArray(config.labels) ? config.labels : []) if (typeof name === 'string') add(name, file);
  return [...wanted.values()];
}

/** The ref that the rulesets API gives for a tag pattern: `v*` is `refs/tags/v*`. */
export const tagRef = (pattern) => (pattern.startsWith('refs/tags/') ? pattern : `refs/tags/${pattern}`);

/**
 * Whether the conditions of a ruleset hold each tag of the ref pattern. An
 * exclusion can remove some of those tags, and two glob patterns cannot be
 * compared exactly, so a ruleset with an exclusion does not count.
 */
const covers = (conditions, ref) => (conditions?.ref_name?.include ?? []).some((include) => include === ref || include === '~ALL') && !(conditions?.ref_name?.exclude ?? []).length;

/**
 * A test that the tags of `config.tagRuleset` cannot get the change `type`.
 * GitHub applies the rules of each active ruleset together, so the rule can
 * come from any ruleset that covers the pattern. A ruleset in `evaluate`
 * mode only reports, and a `disabled` one does nothing.
 */
const blocksTags = (type, change) => (rulesets, config) => {
  const ref = tagRef(config.tagRuleset);
  const covering = rulesets.filter((ruleset) => ruleset.target === 'tag' && covers(ruleset.conditions, ref) && ruleset.rules?.some((rule) => rule.type === type));
  if (covering.some((ruleset) => ruleset.enforcement === 'active')) return true;
  const inactive = covering.map((ruleset) => `\`${ruleset.name}\` is \`${ruleset.enforcement}\``);
  return `No active tag ruleset on \`${ref}\` blocks ${change}${inactive.length ? `: ${inactive.join(', ')}` : ''}.`;
};

const hasRule = (type) => (rules) => rules.some((rule) => rule.type === type);
const requiredContexts = (rules) =>
  rules.filter((rule) => rule.type === 'required_status_checks').flatMap((rule) => rule.parameters?.required_status_checks?.map((check) => check.context) ?? []);

/**
 * Each setting the template sets, with the source it is read from, a test,
 * and what to change. A test returns true when the setting is correct, false
 * when it is not, undefined when the source does not say, and a string for a
 * finding with detail. A setting with `when` applies only to a config for
 * which `when` returns true.
 */
export const SETTINGS = {
  'merge.squash-only': {
    source: 'merge',
    test: (m) => (m.squashMergeAllowed == null ? undefined : m.squashMergeAllowed === true && m.mergeCommitAllowed === false && m.rebaseMergeAllowed === false),
    fix: 'Allow squash merges only, in Settings, General, Pull requests.',
  },
  'merge.squash-body': {
    source: 'merge',
    test: (m) => (m.squashMergeCommitMessage == null ? undefined : m.squashMergeCommitTitle === 'COMMIT_OR_PR_TITLE' && m.squashMergeCommitMessage === 'COMMIT_MESSAGES'),
    fix: 'Make the default squash commit the commit title and the commit messages of the branch.',
  },
  'merge.delete-branch': {
    source: 'merge',
    test: (m) => (m.deleteBranchOnMerge == null ? undefined : m.deleteBranchOnMerge === true),
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
  'tags.no-update': {
    source: 'tags',
    when: (config) => config.tagRuleset !== undefined,
    test: blocksTags('update', 'updates'),
    fix: 'Restrict updates in an active tag ruleset that targets the `tagRuleset` pattern with no exclusion, in Settings, Rules.',
  },
  'tags.no-deletion': {
    source: 'tags',
    when: (config) => config.tagRuleset !== undefined,
    test: blocksTags('deletion', 'deletions'),
    fix: 'Restrict deletions in an active tag ruleset that targets the `tagRuleset` pattern with no exclusion, in Settings, Rules.',
  },
  'labels.exist': {
    source: 'labels',
    when: (config, context) => context.labels.length > 0,
    test: (labels, config, context) => {
      const names = new Set((Array.isArray(labels) ? labels : []).map((label) => String(label?.name).toLowerCase()));
      const missing = context.labels.filter((label) => !names.has(label.name.toLowerCase()));
      return missing.length ? missing.map((label) => `The label \`${label.name}\` does not exist, and ${label.files.join(' and ')} ${label.files.length > 1 ? 'ask' : 'asks'} for it.`) : true;
    },
    fix: 'Create the label (repo-template docs/repository-settings.md has the commands), or remove it from the file.',
    unreadable: 'Give the token "Issues: read", which the labels of a private repository need.',
  },
};

/** Whether the config asks for a setting. */
const applies = (setting, config, context) => !setting.when || setting.when(config, context);

/** What the settings need besides the config: the labels that the config and the forms ask for. */
const contextOf = (config, forms, file) => ({ labels: wantedLabels(config, forms, file) });

/** The answer of one endpoint, read through `get(path)`, which resolves to `{ status, body }`. */
async function read(get, source) {
  const answer = await readPath(get, source, SOURCES[source]);
  if (source === 'labels' && answer.ok) return readPages(get, source, answer.value);
  if (source !== 'tags' || !answer.ok) return answer;
  // The list gives no conditions and no rules. GET by id gives both.
  const rulesets = [];
  for (const { id, target } of Array.isArray(answer.value) ? answer.value : []) {
    if (target !== 'tag') continue;
    const one = await readPath(get, source, `/rulesets/${id}`);
    if (!one.ok) return one;
    rulesets.push(one.value);
  }
  return { ok: true, value: rulesets };
}

/**
 * Each page of a list of 100 that starts with `first`. The API gives the next
 * page in a Link header, and `get` gives no headers, so a page that is not
 * full is the last one.
 */
async function readPages(get, source, first) {
  const items = Array.isArray(first) ? [...first] : [];
  for (let page = 2, last = items.length; last === 100; page += 1) {
    const next = await readPath(get, source, `${SOURCES[source]}&page=${page}`);
    if (!next.ok) return next;
    last = Array.isArray(next.value) ? next.value.length : 0;
    if (last) items.push(...next.value);
  }
  return { ok: true, value: items };
}

/** The answer of one path of a source. A failure that is not at the path of the source names its own path. */
async function readPath(get, source, suffix) {
  const { status, body } = await get(suffix);
  // GitHub's own reason, which tells a missing permission from a plan that
  // does not offer the setting ("Upgrade to GitHub Pro or make this
  // repository public").
  // GraphQL gives its errors as a list, with HTTP 200.
  const errors = Array.isArray(body?.errors) ? body.errors.map((error) => error?.message).filter(Boolean).join(' ') : body?.errors;
  const reason = [body?.message, typeof errors === 'string' ? errors : null].filter(Boolean).join(': ');
  const failed = { ok: false, status, ...(reason ? { reason } : {}), ...(suffix === SOURCES[source] ? {} : { path: suffix }) };
  if (source === 'merge') return status === 200 && body?.data?.repository ? { ok: true, value: body.data.repository } : failed;
  if (source === 'alerts') return status === 204 ? { ok: true, value: true } : status === 404 ? { ok: true, value: false } : failed;
  return status === 200 ? { ok: true, value: body } : failed;
}

/** The merge settings, which GraphQL gives to a token with read access. */
export const MERGE_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed squashMergeCommitTitle squashMergeCommitMessage deleteBranchOnMerge
  }
}`;

/** What to do about a setting that cannot be read. */
const UNREADABLE = 'Give the token "Administration: read", or, if the plan does not offer the setting on this repository, add an exception with the reason.';

/** Each source that a setting of the config and the forms needs, read once. */
export async function readState(get, config = {}, { forms = {} } = {}) {
  const context = contextOf(config, forms);
  const needed = new Set(Object.values(SETTINGS).filter((setting) => applies(setting, config, context)).map((setting) => setting.source));
  const entries = await Promise.all([...needed].map(async (source) => [source, await read(get, source)]));
  return Object.fromEntries(entries);
}

/** What the config and the forms are wrong about, as sentences. */
function configProblems(config, file, forms, context) {
  const out = [];
  for (const [form, labels] of Object.entries(forms)) {
    if (labels === null) out.push(`${form} labels could not be read. Write them as a list on one line, for example \`labels: [bug]\`.`);
  }
  if (config.labels !== undefined && (!Array.isArray(config.labels) || !config.labels.every((name) => typeof name === 'string' && name.trim()))) {
    out.push(`${file} labels must be a list of label names.`);
  }
  if (config.requiredChecks !== undefined && (!Array.isArray(config.requiredChecks) || !config.requiredChecks.every((name) => typeof name === 'string'))) {
    out.push(`${file} requiredChecks must be a list of check names.`);
  }
  if (config.tagRuleset !== undefined && (typeof config.tagRuleset !== 'string' || !config.tagRuleset.trim())) {
    out.push(`${file} tagRuleset must be the pattern of the release tags, for example "v*".`);
  }
  for (const [index, entry] of (config.exceptions ?? []).entries()) {
    if (!SETTINGS[entry?.setting]) out.push(`${file} exception ${index + 1} names \`${entry?.setting}\`, which is not a setting. The settings are ${Object.keys(SETTINGS).join(', ')}.`);
    else if (typeof entry.reason !== 'string' || !entry.reason.trim()) out.push(`${file} exception for \`${entry.setting}\` has no reason.`);
    else if (!applies(SETTINGS[entry.setting], config, context)) out.push(`${file} excepts \`${entry.setting}\`, which this config does not check. Remove the exception.`);
  }
  return out;
}

/** The verdict on one state against the config, as lines and an exit code. */
export function check(state, config = {}, { file = '.repo-settings.json', forms = {} } = {}) {
  const context = contextOf(config, forms, file);
  const lines = configProblems(config, file, forms, context).map((problem) => `::error::${problem}`);
  if (lines.length) return { lines, code: 1 };
  const excepted = new Map((config.exceptions ?? []).map((entry) => [entry.setting, entry.reason]));
  let correct = 0;
  for (const [id, setting] of Object.entries(SETTINGS)) {
    if (!applies(setting, config, context)) continue;
    const { source, test, fix, unreadable = UNREADABLE } = setting;
    const answer = state[source];
    let findings;
    if (!answer.ok) {
      findings = [`${id} could not be read: ${answer.path ?? (SOURCES[source] || '/')} answered HTTP ${answer.status}${answer.reason ? ` (${answer.reason})` : ''}. ${unreadable}`];
    } else {
      const verdict = test(answer.value, config, context);
      if (verdict === true) findings = [];
      else if (verdict === undefined) findings = [`${id} could not be read: the answer has no value for it. ${unreadable}`];
      // A list is one finding for each item, so that each missing label has its own line.
      else findings = (Array.isArray(verdict) ? verdict : [verdict]).map((detail) => `${id} is wrong. ${typeof detail === 'string' ? `${detail} ` : ''}${fix}`);
    }
    if (excepted.has(id)) {
      if (!findings.length) lines.push(`::error::${file} excepts \`${id}\`, which is correct now. Remove the exception.`);
    } else if (!findings.length) correct += 1;
    else lines.push(...findings.map((finding) => `::error::${finding}`));
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
  const graphql = process.env.GITHUB_GRAPHQL_URL ?? 'https://api.github.com/graphql';
  const [owner, name] = values.repo.split('/');
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', authorization: `Bearer ${token}` };
  const get = async (suffix) => {
    const response =
      suffix === SOURCES.merge
        ? await fetch(graphql, { method: 'POST', headers, body: JSON.stringify({ query: MERGE_QUERY, variables: { owner, name } }) })
        : await fetch(`${api}/repos/${values.repo}${suffix}`, { headers });
    return { status: response.status, body: response.status === 204 ? null : await response.json().catch(() => null) };
  };
  const config = existsSync(values.config) ? JSON.parse(readFileSync(values.config, 'utf8')) : {};
  const forms = readForms();
  const { lines, code } = check(await readState(get, config, { forms }), config, { file: values.config, forms });
  for (const line of lines) console.log(line);
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href) {
  process.exitCode = await main();
}
