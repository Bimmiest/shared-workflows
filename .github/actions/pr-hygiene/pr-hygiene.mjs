#!/usr/bin/env node
/**
 * Whether a pull request follows the branch and issue conventions
 * (propslab-ent #1599, ADR 148). The rules lived in prose; about half of the
 * fifty merges before the check cited no issue, and eleven reached `main`
 * from automated `claude/…` branches. A warning would have joined the prose,
 * so this fails.
 *
 * Everything about the pull request arrives through the environment, never
 * interpolated into a command, because the body and the branch are whatever
 * their author typed:
 *
 *   PR_BRANCH            the head ref
 *   PR_BODY              the description
 *   PR_LABELS            the label names, as a JSON array
 *   PR_AUTHOR            the login that opened it
 *   PR_TYPES             the allowed branch types, comma-separated
 *                        (default feature,fix,refactor,docs,ci,chore)
 *   PR_NO_ISSUE_LABEL    the label that exempts a typo-sized change from
 *                        naming an issue (default no-issue)
 *   PR_EXEMPT_AUTHORS    logins whose branches a tool names, comma-separated
 *                        (default dependabot[bot])
 *
 * Prints every rule the pull request broke as a `::error::` annotation and
 * exits 1, or prints that it passed and exits 0.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_TYPES = ['feature', 'fix', 'refactor', 'docs', 'ci', 'chore'];
export const DEFAULT_NO_ISSUE_LABEL = 'no-issue';
export const DEFAULT_EXEMPT_AUTHORS = ['dependabot[bot]'];

/**
 * `<type>/<short-description>-<issue-number>`: the type list, then a
 * lower-case kebab description. The trailing `-<n>` is optional here because
 * a `no-issue` pull request may omit it; whether it *must* be present is
 * `check`'s question, not the pattern's.
 */
export function branchPattern(types = DEFAULT_TYPES) {
  const escaped = types.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^(${escaped.join('|')})\\/[a-z0-9][a-z0-9-]*(-[0-9]+)?$`);
}

/**
 * `Closes #12`, `Fixes #12`, `Refs #12`, and the other spellings GitHub
 * itself treats as closing keywords, so a body GitHub links is never refused.
 */
const LINK = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\b:?\s+#(\d+)\b/gi;

/**
 * The issue numbers the body links. HTML comments are dropped first: a pull
 * request template's guidance lives in them, and an example there is not a
 * link the author made.
 */
export function linkedIssues(body) {
  const visible = (body ?? '').replace(/<!--[\s\S]*?-->/g, '');
  return [...visible.matchAll(LINK)].map((match) => Number(match[1]));
}

/**
 * The issue number a conforming branch ends in, or null. Read with a pattern
 * of its own because the description class is greedy and matches numerals
 * too. A description that happens to end in a number (`chore/node-24`) is
 * read as naming issue 24; the check then asks for `#24` to be linked, and
 * its message says so.
 */
export function branchIssue(branch, pattern = branchPattern()) {
  if (!pattern.test(branch)) return null;
  const match = /-([0-9]+)$/.exec(branch);
  return match ? Number(match[1]) : null;
}

/** Every rule the pull request breaks, as sentences naming the fix. Empty means it passes. */
export function check(
  { branch, body, labels = [], author },
  { types = DEFAULT_TYPES, noIssueLabel = DEFAULT_NO_ISSUE_LABEL, exemptAuthors = DEFAULT_EXEMPT_AUTHORS } = {},
) {
  if (exemptAuthors.includes(author)) return [];

  const pattern = branchPattern(types);
  const problems = [];
  const exempt = labels.includes(noIssueLabel);

  if (!pattern.test(branch)) {
    problems.push(
      `Branch \`${branch}\` does not match \`<type>/<short-description>-<issue-number>\`, ` +
        `where <type> is ${types.join(', ')} and the description is lower-case kebab. ` +
        `Rename the branch and reopen the pull request from it, and say so in the description.`,
    );
  }

  if (exempt) return problems;

  const named = branchIssue(branch, pattern);
  const linked = linkedIssues(body);

  if (pattern.test(branch) && named === null) {
    problems.push(
      `Branch \`${branch}\` names no issue. End it in \`-<issue-number>\`, ` +
        `or label the pull request \`${noIssueLabel}\` if the change is genuinely too small for one.`,
    );
  }

  if (linked.length === 0) {
    problems.push(
      `The description links no issue. Add \`Closes #<n>\`, \`Fixes #<n>\` or \`Refs #<n>\`, ` +
        `or label the pull request \`${noIssueLabel}\` if the change is genuinely too small for one.`,
    );
  } else if (named !== null && !linked.includes(named)) {
    problems.push(
      `Branch \`${branch}\` names #${named}, but the description links ${linked.map((n) => `#${n}`).join(', ')}. Link the issue the branch names.`,
    );
  }

  return problems;
}

/** A message made safe to follow `::error::` on one line. */
export function escapeCommand(message) {
  return message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

const list = (text, fallback) => {
  if (typeof text !== 'string' || text.trim() === '') return fallback;
  return text.split(',').map((s) => s.trim()).filter(Boolean);
};

/** Reads the pull request and the rules from the environment, as the action passes them. */
export function fromEnv(env) {
  let labels = [];
  try {
    const parsed = JSON.parse(env.PR_LABELS || '[]');
    if (Array.isArray(parsed)) labels = parsed.map(String);
  } catch {
    // An unreadable label list is treated as no labels: the check then asks
    // for more rather than less, which is the safe direction to be wrong in.
  }
  return {
    request: { branch: env.PR_BRANCH ?? '', body: env.PR_BODY ?? '', labels, author: env.PR_AUTHOR ?? '' },
    rules: {
      types: list(env.PR_TYPES, DEFAULT_TYPES),
      noIssueLabel: env.PR_NO_ISSUE_LABEL?.trim() || DEFAULT_NO_ISSUE_LABEL,
      exemptAuthors: list(env.PR_EXEMPT_AUTHORS, DEFAULT_EXEMPT_AUTHORS),
    },
  };
}

/** The lines to print and the exit code, for the pull request `env` describes. */
export function run(env) {
  const { request, rules } = fromEnv(env);
  const problems = check(request, rules);
  if (problems.length === 0) return { lines: ['Branch and issue link follow the convention.'], code: 0 };
  // `::error::` so each rule is its own annotation on the pull request, rather
  // than a line somebody has to open the log to find. Escaped as the runner's
  // workflow-command syntax requires: the branch name is author-chosen, and an
  // unescaped line break in it would start a command of the author's choosing.
  // (The body is never printed.)
  return { lines: problems.map((problem) => `::error::${escapeCommand(problem)}`), code: 1 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { lines, code } = run(process.env);
  for (const line of lines) console.log(line);
  process.exitCode = code;
}
