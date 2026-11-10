import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { buildRequest, isResult, MARKER, parseReply, renderComment, run, sanitize, SCHEMA, upsertComment } from './review.mjs';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A fetch that answers each call from `answers` in turn, and records the calls. */
function stubFetch(answers) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body, headers: init.headers });
    const next = answers.shift() ?? { status: 500, body: '' };
    return new Response(typeof next.body === 'string' ? next.body : JSON.stringify(next.body), { status: next.status ?? 200 });
  };
  return calls;
}

const reply = (verdict, reasons = []) => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ verdict, reasons }) }] });
const facts = {
  pullRequest: { number: 12, headSha: 'f00d', title: 't', body: 'b' },
  packages: [{ name: 'left-pad', from: '1.0.0', to: '2.0.0', zeroMinor: false, sites: [{ file: 'src/a.ts', line: 3 }] }],
  nestedCopies: [],
};

describe('buildRequest', () => {
  it('pins the model, asks for the schema, opts into fallbacks, and sends the facts as data', () => {
    const { headers, body } = buildRequest(facts, { model: 'claude-opus-5-5', prompt: 'P', apiKey: 'k' });
    assert.equal(headers['x-api-key'], 'k');
    assert.equal(headers['anthropic-version'], '2026-10-21');
    assert.equal(headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
    assert.equal(body.model, 'claude-opus-5-5');
    assert.equal(body.fallbacks, 'default');
    assert.equal(body.system, 'P');
    assert.deepEqual(body.output_config, { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } });
    assert.equal(body.messages[0].content, `<facts>\n${JSON.stringify(facts)}\n</facts>`);
  });
});

describe('parseReply', () => {
  it('reads the verdict and at most eight reasons', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ text: `r${i}`, file: null }));
    const review = parseReply(reply('needs-attention', many));
    assert.equal(review.verdict, 'needs-attention');
    assert.equal(review.reasons.length, 8);
    assert.equal(review.declined, false);
  });

  it('reads a refusal as a decline, which still gets a comment', () => {
    assert.deepEqual(parseReply({ stop_reason: 'refusal', model: 'm' }), { declined: true, model: 'm' });
  });

  it('throws on a reply that was cut off, has no text, is not JSON, or does not match the schema', () => {
    assert.throws(() => parseReply({ stop_reason: 'max_tokens', content: [] }), /max_tokens/);
    assert.throws(() => parseReply({ stop_reason: 'end_turn', content: [] }), /no text block/);
    assert.throws(() => parseReply({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'merge it' }] }), /not JSON/);
    assert.throws(() => parseReply(reply('ship-it')), /schema/);
  });
});

describe('isResult', () => {
  it('holds the schema: a known verdict, and reasons with text and a file or null', () => {
    assert.equal(isResult({ verdict: 'merge', reasons: [{ text: 'x', file: null }] }), true);
    assert.equal(isResult({ verdict: 'merge', reasons: [{ text: 'x', file: 3 }] }), false);
    assert.equal(isResult({ verdict: 'merge', reasons: {} }), false);
    assert.equal(isResult(null), false);
  });
});

describe('sanitize', () => {
  it('leaves no link, image, mention, autolink or HTML that the model wrote', () => {
    const attack = 'See [x](https://evil.example) ![i](https://evil.example/i.png) @octocat https://evil.example www.evil.example <!-- --> </details> `code` #1';
    const out = sanitize(attack);
    assert.ok(!/\]\(/.test(out.replace(/\\\]\\\(/g, '')), 'no link syntax');
    assert.ok(!out.includes('@octocat'), 'no mention');
    assert.ok(!/https:\/\//.test(out), 'no autolink');
    assert.ok(!out.includes('www.evil'), 'no www autolink');
    assert.ok(!/(^|[^\\])</.test(out), 'every < is escaped');
    assert.ok(!/(^|[^\\])`/.test(out), 'every backtick is escaped');
    assert.ok(out.includes('\\#1'), 'no issue reference');
  });

  it('makes one line, and caps the length', () => {
    assert.equal(sanitize('a\nb\tc'), 'a b c');
    const long = sanitize('x'.repeat(1000), 10);
    assert.equal(long.length, 10);
    assert.ok(long.endsWith('…'));
  });
});

describe('renderComment', () => {
  it('starts with the marker, states the verdict as advice, and links only a file the facts name', () => {
    const body = renderComment(
      { declined: false, model: 'claude-opus-5-5', verdict: 'merge', reasons: [{ text: 'Fine.', file: 'src/a.ts' }, { text: 'Other.', file: 'src/b.ts' }] },
      facts,
      { repository: 'o/r', sha: 'f00d' },
    );
    assert.ok(body.startsWith(MARKER));
    assert.match(body, /\*\*Verdict: merge\.\*\* This is advice/);
    assert.ok(body.includes('[`src/a.ts`](https://github.com/o/r/blob/f00d/src/a.ts)'));
    assert.ok(body.includes('(`src/b.ts`)'), 'a file the facts do not name gets no link');
    assert.match(body, /\| left\\-pad \| 1\.0\.0 \| 2\.0\.0 \| 1 usages \|/);
    assert.ok(body.includes('No new nested copy in the lockfile.'));
  });

  it('says that the model declined, and still shows what the checks found', () => {
    const body = renderComment({ declined: true, model: 'm' }, { ...facts, nestedCopies: [{ path: 'node_modules/a/node_modules/b', nested: '1.0.0' }] });
    assert.match(body, /The model declined to review this update/);
    assert.ok(renderComment({ declined: true, model: 'm' }, { packages: [], nestedCopies: [] }).includes('No package changed at the top level.'));
    assert.match(body, /New nested copies: node\\_modules/);
  });
});

describe('upsertComment', () => {
  const args = { apiUrl: 'https://api.test', repository: 'o/r', number: 12, token: 't', body: 'B' };

  it('updates the comment that the bot wrote with the marker', async () => {
    const calls = stubFetch([{ body: [{ id: 5, user: { login: 'someone' }, body: MARKER }, { id: 9, user: { login: 'github-actions[bot]' }, body: `${MARKER}\nold` }] }, { body: {} }]);
    assert.equal(await upsertComment(args), 'updated');
    assert.equal(calls[1].method, 'PATCH');
    assert.equal(calls[1].url, 'https://api.test/repos/o/r/issues/comments/9');
  });

  it('adds a comment when only somebody else used the marker', async () => {
    const calls = stubFetch([{ body: [{ id: 5, user: { login: 'someone' }, body: MARKER }] }, { body: {} }]);
    assert.equal(await upsertComment(args), 'added');
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[1].url, 'https://api.test/repos/o/r/issues/12/comments');
  });
});

describe('run', () => {
  async function withFacts(fn) {
    const dir = mkdtempSync(path.join(tmpdir(), 'review-'));
    try {
      const factsPath = path.join(dir, 'facts.json');
      writeFileSync(factsPath, JSON.stringify(facts));
      await fn(dir, factsPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('writes the comment to a file from a good reply', async () => {
    await withFacts(async (dir, factsPath) => {
      const calls = stubFetch([{ body: reply('merge') }]);
      const commentFile = path.join(dir, 'comment.md');
      assert.equal(await run({ factsPath, apiKey: 'k', apiUrl: 'https://api.test', commentFile }), 0);
      assert.equal(calls[0].url, 'https://api.test/v1/messages');
      assert.match(readFileSync(commentFile, 'utf8'), /Verdict: merge/);
    });
  });

  it('posts the comment when there is no comment file', async () => {
    await withFacts(async (_dir, factsPath) => {
      const calls = stubFetch([{ body: reply('merge') }, { body: [] }, { body: {} }]);
      const github = { apiUrl: 'https://gh.test', repository: 'o/r', token: 't' };
      assert.equal(await run({ factsPath, apiKey: 'k', apiUrl: 'https://api.test', github }), 0);
      assert.equal(calls[2].url, 'https://gh.test/repos/o/r/issues/12/comments');
    });
  });

  it('fails with no key, on an API error, or with nowhere to comment', async () => {
    await withFacts(async (_dir, factsPath) => {
      assert.equal(await run({ factsPath, apiKey: '' }), 1);
      stubFetch([{ status: 500, body: { error: { type: 'api_error' } } }]);
      assert.equal(await run({ factsPath, apiKey: 'k', apiUrl: 'https://api.test' }), 1);
      stubFetch([{ body: reply('merge') }]);
      assert.equal(await run({ factsPath, apiKey: 'k', apiUrl: 'https://api.test', github: {} }), 1);
    });
  });
});

describe('the edges of a review', () => {
  it('notes a 0.x minor move, names an unknown model, and lists a nested copy with no version', () => {
    const body = renderComment(
      { declined: false, model: null, verdict: 'needs-attention', reasons: [] },
      { packages: [{ name: 'z', from: null, to: '0.2.0', zeroMinor: true, sites: [] }], nestedCopies: [{ path: 'node_modules/a/node_modules/b', nested: null }] },
    );
    assert.match(body, /\| z \| added \| 0\.2\.0 \| 0\.x minor: may break \|/);
    assert.ok(body.includes('No reason was given.'));
    assert.ok(body.includes('Model: unknown.'));
    assert.ok(body.includes('New nested copies: node\\_modules/a/node\\_modules/b.'));
  });

  it('gives a file the facts name no link when there is no commit to link to', () => {
    const body = renderComment({ declined: false, model: 'm', verdict: 'merge', reasons: [{ text: 'x', file: 'src/a.ts' }] }, facts, { repository: 'o/r' });
    assert.ok(body.includes('(`src/a.ts`)'));
  });

  it('reads a reply with no model, and a reason that is not an object', () => {
    const { model: _model, ...noModel } = reply('merge');
    assert.equal(parseReply(noModel).model, null);
    assert.equal(isResult({ verdict: 'merge', reasons: [null] }), false);
  });

  it('reports the status alone when the error body is not JSON', async () => {
    stubFetch([{ status: 502, body: '<html>bad gateway</html>' }]);
    const dir = mkdtempSync(path.join(tmpdir(), 'review-'));
    try {
      const factsPath = path.join(dir, 'facts.json');
      writeFileSync(factsPath, JSON.stringify(facts));
      assert.equal(await run({ factsPath, apiKey: 'k', apiUrl: 'https://api.test' }), 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('looks on the next page of comments, and adds one when no page has it', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ id: i, user: { login: 'someone' }, body: 'x' }));
    const calls = stubFetch([{ body: full }, { body: [{ id: 200, user: { login: 'github-actions[bot]' }, body: MARKER }] }, { body: {} }]);
    assert.equal(await upsertComment({ apiUrl: 'https://api.test', repository: 'o/r', number: 1, token: 't', body: 'B' }), 'updated');
    assert.match(calls[1].url, /page=2$/);
    const none = stubFetch([{ body: full }, { body: [] }, { body: {} }]);
    assert.equal(await upsertComment({ apiUrl: 'https://api.test', repository: 'o/r', number: 1, token: 't', body: 'B' }), 'added');
    assert.equal(none[2].method, 'POST');
  });
});
