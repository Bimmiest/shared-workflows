#!/usr/bin/env node
/**
 * The advisory review of a dependency update (#81): one request to the
 * Messages API, and one comment on the pull request.
 *
 *   node review.mjs --facts facts.json [--model claude-opus-5-5] [--comment-file out.md]
 *
 * This runs in the job that holds the API key, which never checks out the
 * pull request: the facts come from the job without a secret, and are read
 * here as untrusted data. The verdict is advice. It is never a required
 * check, and the step fails only when it cannot produce a comment.
 *
 * The model's text reaches the comment only through `sanitize`: no Markdown,
 * no link, no image, no mention. A link to a file is made here, and only to
 * a file that the facts name.
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MARKER = '<!-- shared-workflows:dependabot-review -->';
export const VERDICTS = ['merge', 'needs-attention', 'do-not-merge'];
const BOT = 'github-actions[bot]';
const MAX_REASONS = 8;
const MAX_REASON_CHARS = 600;

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'reasons'],
  properties: {
    verdict: { type: 'string', enum: VERDICTS },
    reasons: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'file'],
        properties: { text: { type: 'string' }, file: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
      },
    },
  },
};

/** The request: the fixed prompt as the system prompt, and the facts as data. */
export function buildRequest(facts, { model, prompt, apiKey }) {
  return {
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2026-10-21',
      // A decline on a safety classifier is re-run on another model, inside the same call.
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: {
      model,
      max_tokens: 8000,
      fallbacks: 'default',
      system: prompt,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: `<facts>\n${JSON.stringify(facts)}\n</facts>` }],
    },
  };
}

/** Whether `value` is the shape that SCHEMA describes. The API enforces it; this holds a reply that did not come from it. */
export function isResult(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    VERDICTS.includes(value.verdict) &&
    Array.isArray(value.reasons) &&
    value.reasons.every((r) => r && typeof r.text === 'string' && (r.file === null || typeof r.file === 'string'))
  );
}

/** The review from a Messages API reply: a verdict and reasons, or a decline. Throws when there is neither. */
export function parseReply(reply) {
  if (reply?.stop_reason === 'refusal') return { declined: true, model: reply.model ?? null };
  if (reply?.stop_reason === 'max_tokens') throw new Error('The reply stopped at max_tokens, before the verdict was complete.');
  const text = (reply?.content ?? []).find((block) => block?.type === 'text')?.text;
  if (typeof text !== 'string') throw new Error(`The reply has no text block (stop_reason ${reply?.stop_reason ?? 'none'}).`);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('The reply is not JSON.');
  }
  if (!isResult(value)) throw new Error('The reply does not match the verdict schema.');
  return { declined: false, model: reply.model ?? null, verdict: value.verdict, reasons: value.reasons.slice(0, MAX_REASONS) };
}

/**
 * Text from the model or the facts, made safe for a comment: one line, every
 * Markdown and HTML character escaped, no mention, no autolink, and a length
 * cap. A zero-width space breaks a mention or an autolink without hiding it.
 */
export function sanitize(text, max = MAX_REASON_CHARS) {
  let out = String(text)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[\\`*_{}[\]()#+!|<>~=-]/g, '\\$&')
    .replace(/@(?=[A-Za-z0-9])/g, '@\u200b')
    .replace(/\b(https?|ftp):\/\//gi, '$1:\u200b//')
    .replace(/\bwww\./gi, 'www\u200b.')
    .trim();
  if (out.length > max) out = `${out.slice(0, max - 1)}…`;
  return out;
}

/** A file reference, linked only when the facts name the file. */
function fileRef(file, facts, { serverUrl, repository, sha }) {
  const known = new Set((facts.packages ?? []).flatMap((p) => (p.sites ?? []).map((s) => s.file)));
  const label = `\`${String(file).replace(/[`\u0000-\u001f]/g, '')}\``;
  if (!known.has(file) || !sha || !repository) return label;
  const href = `${serverUrl}/${repository}/blob/${sha}/${String(file).split('/').map(encodeURIComponent).join('/')}`;
  return `[${label}](${href})`;
}

/** The comment: the verdict and reasons, then what the checks found. */
export function renderComment(review, facts, links = {}) {
  const lines = [MARKER, '### Advisory review of this update', ''];
  if (review.declined) {
    lines.push('The model declined to review this update, so there is no verdict. Read the release notes against the usages below.');
  } else {
    lines.push(`**Verdict: ${review.verdict}.** This is advice. It is not a required check, and nothing merges because of it.`, '');
    if (review.reasons.length === 0) lines.push('No reason was given.');
    for (const reason of review.reasons) {
      const ref = reason.file ? ` (${fileRef(reason.file, facts, { serverUrl: 'https://github.com', ...links })})` : '';
      lines.push(`- ${sanitize(reason.text)}${ref}`);
    }
  }
  lines.push('', '<details><summary>What the checks found</summary>', '');
  const packages = facts.packages ?? [];
  if (packages.length === 0) lines.push('No package changed at the top level.');
  else lines.push('| Package | From | To | Note |', '|---|---|---|---|');
  for (const p of packages) {
    const note = p.zeroMinor ? '0.x minor: may break' : `${(p.sites ?? []).length} usages`;
    lines.push(`| ${sanitize(p.name, 200)} | ${sanitize(p.from ?? 'added', 60)} | ${sanitize(p.to ?? 'removed', 60)} | ${note} |`);
  }
  const nested = facts.nestedCopies ?? [];
  lines.push('', nested.length === 0 ? 'No new nested copy in the lockfile.' : `New nested copies: ${nested.map((c) => sanitize(`${c.path} ${c.nested ?? ''}`, 200)).join(', ')}.`);
  lines.push('', '</details>', '', `Model: ${sanitize(review.model ?? 'unknown', 80)}. The release notes are text that each package's maintainers wrote, so a verdict is never a reason to merge.`);
  return lines.join('\n');
}

async function request(url, init, what) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
  const text = await response.text();
  if (!response.ok) {
    let detail = '';
    try {
      detail = JSON.parse(text)?.error?.type ?? '';
    } catch {
      // A body that is not JSON says nothing more than the status.
    }
    throw new Error(`${what} answered ${response.status}${detail ? ` (${detail})` : ''}.`);
  }
  return text === '' ? null : JSON.parse(text);
}

/** Updates the one comment that this workflow wrote, found by its marker and its author, or adds it. */
export async function upsertComment({ apiUrl, repository, number, token, body }) {
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' };
  for (let page = 1; page <= 10; page++) {
    const comments = await request(`${apiUrl}/repos/${repository}/issues/${number}/comments?per_page=100&page=${page}`, { headers }, 'GitHub');
    const ours = comments.find((c) => c?.user?.login === BOT && String(c.body ?? '').includes(MARKER));
    if (ours) {
      await request(`${apiUrl}/repos/${repository}/issues/comments/${ours.id}`, { method: 'PATCH', headers, body: JSON.stringify({ body }) }, 'GitHub');
      return 'updated';
    }
    if (comments.length < 100) break;
  }
  await request(`${apiUrl}/repos/${repository}/issues/${number}/comments`, { method: 'POST', headers, body: JSON.stringify({ body }) }, 'GitHub');
  return 'added';
}

/** Reads the facts, asks the model, and writes or posts the comment. Returns the exit code. */
export async function run({
  factsPath,
  model = 'claude-opus-5-5',
  apiKey = process.env.ANTHROPIC_API_KEY,
  apiUrl = 'https://api.anthropic.com',
  commentFile,
  github = {
    apiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
  },
} = {}) {
  try {
    if (!apiKey) throw new Error('No API key: set the api-key input from a secret.');
    const facts = JSON.parse(readFileSync(factsPath, 'utf8'));
    const prompt = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompt.md'), 'utf8');
    const { headers, body } = buildRequest(facts, { model, prompt, apiKey });
    const reply = await request(`${apiUrl}/v1/messages`, { method: 'POST', headers, body: JSON.stringify(body) }, 'The Messages API');
    const review = parseReply(reply);
    const comment = renderComment(review, facts, { repository: github.repository, sha: facts.pullRequest?.headSha });
    if (commentFile) {
      writeFileSync(commentFile, `${comment}\n`);
      console.log(`Wrote the comment to ${commentFile}: ${review.declined ? 'declined' : review.verdict}.`);
    } else {
      const number = facts.pullRequest?.number;
      if (!number || !github.repository || !github.token) throw new Error('No pull request number, repository or token to comment with.');
      const how = await upsertComment({ ...github, number, body: comment });
      console.log(`Comment ${how}: ${review.declined ? 'declined' : review.verdict}.`);
    }
    return 0;
  } catch (error) {
    console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

// Importing this file (the test does) must not call anything.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href) {
  const { values } = parseArgs({
    options: {
      facts: { type: 'string', default: 'dependabot-review-facts.json' },
      model: { type: 'string', default: 'claude-opus-5-5' },
      'api-url': { type: 'string', default: 'https://api.anthropic.com' },
      'comment-file': { type: 'string' },
    },
  });
  process.exitCode = await run({ factsPath: values.facts, model: values.model, apiUrl: values['api-url'], commentFile: values['comment-file'] });
}
