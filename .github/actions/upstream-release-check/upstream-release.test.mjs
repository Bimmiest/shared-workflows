import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { compareVersions, fetchReleases, newestRelease, parseVersion, readPin, run, verdict } from './upstream-release.mjs';

// The pin of pcre2-wasm-utf16, as build/build.sh has it.
const BUILD_SH = [
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  'PCRE2_VERSION=10.48',
  'PCRE2_SHA256=ebcc25aadf2a51fa1fefa9b8bc9e7a79b3dae86870a0f1152a22e42befd46888',
  'PCRE2_URL="https://github.com/PCRE2Project/pcre2/releases/download/pcre2-${PCRE2_VERSION}/pcre2-${PCRE2_VERSION}.tar.gz"',
  '',
].join('\n');

const release = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, html_url: `https://github.com/PCRE2Project/pcre2/releases/tag/${tag}`, ...extra });

describe('parseVersion', () => {
  it('reads dotted numbers of any length, with or without a v', () => {
    assert.deepEqual(parseVersion('10.48'), [10, 48]);
    assert.deepEqual(parseVersion(' v1.2.3\n'), [1, 2, 3]);
    assert.deepEqual(parseVersion('7'), [7]);
  });

  it('is null for a release candidate, a quoted value or text', () => {
    assert.equal(parseVersion('10.48-RC1'), null);
    assert.equal(parseVersion('"10.48"'), null);
    assert.equal(parseVersion('latest'), null);
    assert.equal(parseVersion('10..48'), null);
  });
});

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    assert.ok(compareVersions([10, 9], [10, 10]) < 0);
    assert.ok(compareVersions([11], [10, 99]) > 0);
  });

  it('treats a missing part as 0', () => {
    assert.equal(compareVersions([10, 48], [10, 48, 0]), 0);
    assert.ok(compareVersions([10, 48], [10, 48, 1]) < 0);
  });
});

describe('readPin', () => {
  it('reads group 1 of the one line that matches, with ^ and $ at each line', () => {
    assert.equal(readPin(BUILD_SH, '^PCRE2_VERSION=(.+)$', 'build/build.sh'), '10.48');
  });

  it('trims a carriage return from a file with CRLF ends', () => {
    assert.equal(readPin('PCRE2_VERSION=10.48\r\nX=1\r\n', '^PCRE2_VERSION=(.+)$', 'b.sh'), '10.48');
  });

  it('fails when no line matches, or more than one line matches', () => {
    assert.throws(() => readPin(BUILD_SH, '^ZLIB_VERSION=(.+)$', 'build/build.sh'), /No line of build\/build\.sh matches/);
    assert.throws(() => readPin(BUILD_SH, '^PCRE2_(?:VERSION|SHA256)=(.+)$', 'build/build.sh'), /2 lines of build\/build\.sh match/);
  });

  it('fails when the pattern has no group 1, or is not a regular expression', () => {
    assert.throws(() => readPin(BUILD_SH, '^PCRE2_VERSION=', 'build/build.sh'), /no capture group 1/);
    assert.throws(() => readPin(BUILD_SH, '^PCRE2_VERSION=(.+$', 'build/build.sh'), /--pattern is not a regular expression/);
  });
});

describe('newestRelease', () => {
  it('finds the newest version, whatever the order of the list', () => {
    const { newest, skipped } = newestRelease([release('pcre2-10.47'), release('pcre2-10.49'), release('pcre2-10.42.1')], '^pcre2-(.+)$');
    assert.equal(newest.tag, 'pcre2-10.49');
    assert.equal(newest.text, '10.49');
    assert.deepEqual(newest.version, [10, 49]);
    assert.match(newest.url, /tag\/pcre2-10\.49$/);
    assert.deepEqual(skipped, []);
  });

  it('skips drafts and prereleases', () => {
    const releases = [release('pcre2-10.50', { draft: true }), release('pcre2-10.49', { prerelease: true }), release('pcre2-10.48')];
    assert.equal(newestRelease(releases, '^pcre2-(.+)$').newest.tag, 'pcre2-10.48');
  });

  it('skips a tag that the pattern does not match, and names a version it cannot read', () => {
    const releases = [release('other-99.0'), release('pcre2-10.49-RC1'), release('pcre2-10.48'), { tag_name: 7 }, null];
    const { newest, skipped } = newestRelease(releases, '^pcre2-(.+)$');
    assert.equal(newest.tag, 'pcre2-10.48');
    assert.deepEqual(skipped, ['pcre2-10.49-RC1']);
  });

  it('is null when nothing matches, and fails on a tag pattern that is not a regular expression', () => {
    assert.equal(newestRelease([release('v1.0.0')], '^pcre2-(.+)$').newest, null);
    assert.throws(() => newestRelease([], '^pcre2-(.+$'), /--tag-pattern is not a regular expression/);
  });
});

describe('verdict', () => {
  const options = { repository: 'PCRE2Project/pcre2', file: 'build/build.sh', tagPattern: '^pcre2-(.+)$' };
  const newest = { tag: 'pcre2-10.49', text: '10.49', version: [10, 49], url: 'https://example.test/pcre2-10.49' };

  it('passes a pin that is the newest release, or newer', () => {
    assert.deepEqual(verdict('10.49', newest, options), { line: 'build/build.sh pins PCRE2Project/pcre2 10.49. The newest release is 10.49 (pcre2-10.49).', code: 0 });
    assert.equal(verdict('10.49.0', newest, options).code, 0);
    assert.equal(verdict('11.0', newest, options).code, 0);
  });

  it('fails a pin that is behind, and names both versions and the release', () => {
    const { line, code } = verdict('10.48', newest, options);
    assert.equal(code, 1);
    assert.match(line, /^::error title=Upstream release available::build\/build\.sh pins PCRE2Project\/pcre2 10\.48, but 10\.49 \(pcre2-10\.49\) is out\./);
    assert.match(line, /https:\/\/example\.test\/pcre2-10\.49$/);
  });

  it('only warns under warnOnly', () => {
    const { line, code } = verdict('10.48', newest, { ...options, warnOnly: true });
    assert.equal(code, 0);
    assert.match(line, /^::warning title=Upstream release available::/);
  });

  it('fails when there is no release to compare, or the pin is not dotted numbers', () => {
    assert.match(verdict('10.48', null, options).line, /^::error::PCRE2Project\/pcre2 has no release/);
    assert.equal(verdict('10.48', null, options).code, 1);
    assert.match(verdict('"10.48"', newest, options).line, /^::error::build\/build\.sh pins ""10\.48"", which is not a version/);
    assert.equal(verdict('"10.48"', newest, options).code, 1);
  });
});

/** A stand-in for fetch that answers `body` with `status`, and records each request. */
function fakeFetch(body, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => (body instanceof Error ? Promise.reject(body) : body) };
  };
  return { fetchImpl, calls };
}

describe('fetchReleases', () => {
  it('asks for 100 releases, with the token when there is one', async () => {
    const { fetchImpl, calls } = fakeFetch([release('pcre2-10.48')]);
    const releases = await fetchReleases('PCRE2Project/pcre2', { fetchImpl, apiUrl: 'https://ghe.example.test/api/v3', token: 't0k3n' });
    assert.equal(releases.length, 1);
    assert.equal(calls[0].url, 'https://ghe.example.test/api/v3/repos/PCRE2Project/pcre2/releases?per_page=100');
    assert.equal(calls[0].init.headers.authorization, 'Bearer t0k3n');
  });

  it('sends no authorization header with no token', async () => {
    const { fetchImpl, calls } = fakeFetch([]);
    await fetchReleases('PCRE2Project/pcre2', { fetchImpl });
    assert.match(calls[0].url, /^https:\/\/api\.github\.com\/repos\//);
    assert.equal(calls[0].init.headers.authorization, undefined);
  });

  it("fails on an error status with GitHub's reason, and on an answer that is not a list", async () => {
    await assert.rejects(fetchReleases('a/b', { fetchImpl: fakeFetch({ message: 'Not Found' }, 404).fetchImpl }), /answered HTTP 404 \(Not Found\)/);
    await assert.rejects(fetchReleases('a/b', { fetchImpl: fakeFetch(new Error('not JSON'), 502).fetchImpl }), /answered HTTP 502\.$/);
    await assert.rejects(fetchReleases('a/b', { fetchImpl: fakeFetch({ releases: [] }).fetchImpl }), /did not return a list/);
  });
});

describe('run', () => {
  const args = ['--repository=PCRE2Project/pcre2', '--file=build/build.sh', '--pattern=^PCRE2_VERSION=(.+)$', '--tag-pattern=^pcre2-(.+)$'];
  const readFile = (file) => {
    assert.equal(file, 'build/build.sh');
    return BUILD_SH;
  };

  async function check(argv, body, { status = 200, env = {} } = {}) {
    const lines = [];
    const { fetchImpl, calls } = fakeFetch(body, status);
    const code = await run(argv, { fetchImpl, readFile, env, log: (line) => lines.push(line) });
    return { code, lines, calls };
  }

  it('fails when a newer release is out, past a release candidate and a prerelease', async () => {
    const body = [release('pcre2-10.50-RC1'), release('pcre2-10.51', { prerelease: true }), release('pcre2-10.49'), release('pcre2-10.48')];
    const { code, lines, calls } = await check(args, body, { env: { GH_TOKEN: 'secret', GITHUB_API_URL: 'https://api.example.test' } });
    assert.equal(code, 1);
    assert.deepEqual(lines[0], 'Skipped the releases whose version is not dotted numbers: pcre2-10.50-RC1.');
    assert.match(lines[1], /pins PCRE2Project\/pcre2 10\.48, but 10\.49 \(pcre2-10\.49\) is out/);
    assert.match(calls[0].url, /^https:\/\/api\.example\.test\/repos\/PCRE2Project\/pcre2\/releases/);
    assert.equal(calls[0].init.headers.authorization, 'Bearer secret');
  });

  it('passes when the pin is the newest release', async () => {
    const { code, lines } = await check(args, [release('pcre2-10.48'), release('pcre2-10.47')]);
    assert.equal(code, 0);
    assert.deepEqual(lines, ['build/build.sh pins PCRE2Project/pcre2 10.48. The newest release is 10.48 (pcre2-10.48).']);
  });

  it('warns and exits 0 under --warn-only, also when the request fails', async () => {
    assert.equal((await check([...args, '--warn-only'], [release('pcre2-10.49')])).code, 0);
    const { code, lines } = await check([...args, '--warn-only'], { message: 'API rate limit exceeded' }, { status: 403 });
    assert.equal(code, 0);
    assert.match(lines[0], /^::warning::.*answered HTTP 403 \(API rate limit exceeded\)/);
  });

  it('fails when the request fails', async () => {
    const { code, lines } = await check(args, { message: 'Not Found' }, { status: 404 });
    assert.equal(code, 1);
    assert.match(lines[0], /^::error::.*answered HTTP 404/);
  });

  it('fails on a missing input or a repository that is not owner/name, before any request', async () => {
    for (const argv of [[], args.slice(1), ['--repository=https://github.com/PCRE2Project/pcre2', ...args.slice(1)]]) {
      const { code, lines, calls } = await check(argv, []);
      assert.equal(code, 1);
      assert.match(lines[0], /^::error::(No --repository|--repository must be owner\/name)/);
      assert.equal(calls.length, 0);
    }
  });

  it('reads the file from the disk when no readFile is given', async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'upstream-release-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'build.sh');
    writeFileSync(file, BUILD_SH);
    const lines = [];
    const argv = [`--file=${file}`, ...args.filter((arg) => !arg.startsWith('--file='))];
    const code = await run(argv, { fetchImpl: fakeFetch([release('pcre2-10.48')]).fetchImpl, env: {}, log: (line) => lines.push(line) });
    assert.equal(code, 0);
    assert.match(lines[0], /pins PCRE2Project\/pcre2 10\.48\./);
  });

  it('defaults the tag pattern to the version with an optional v', async () => {
    const { code, lines } = await check(args.slice(0, 3), [release('v10.48'), release('10.47')]);
    assert.equal(code, 0);
    assert.match(lines[0], /The newest release is 10\.48 \(v10\.48\)\.$/);
  });
});
