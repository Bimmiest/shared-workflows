import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { annotation, check, compareVersions, FORMS, lowerBound, nodeRanges, parseRange, parseVersion, rangeProblem, run, satisfies } from './node-version.mjs';

/** A range as text again, to compare the comparators in one string. */
const read = (text) => parseRange(text).map(({ op, version }) => `${op}${version.join('.')}`).join(' ');

/** A package.json with the Node ranges of repo-template. */
const TEMPLATE = { engines: { node: '>=26.0.0' }, devEngines: { runtime: { name: 'node', version: '>=26.0.0', onFail: 'error' } } };

/** A package.json like the one of pcre2-wasm-utf16: a library whose users can run an older Node than its own CI. */
const LIBRARY = { engines: { node: '>=22.6.0' } };

describe('parseVersion', () => {
  it('reads x.y.z with or without a v, and nothing else', () => {
    assert.deepEqual(parseVersion('v26.13.0'), [26, 13, 0]);
    assert.deepEqual(parseVersion(' 26.13.0\n'), [26, 13, 0]);
    for (const text of ['26', '26.13', 'lts/*', '26.13.0-rc.1', '']) assert.equal(parseVersion(text), null, text);
  });
});

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    assert.ok(compareVersions([26, 9, 0], [26, 10, 0]) < 0);
    assert.ok(compareVersions([27, 0, 0], [26, 99, 99]) > 0);
    assert.equal(compareVersions([1, 2, 3], [1, 2, 3]), 0);
  });
});

describe('parseRange', () => {
  it('reads each operator before a full version as it is, and a bare full version as =', () => {
    assert.equal(read('>=26.1.2'), '>=26.1.2');
    assert.equal(read('>26.1.2'), '>26.1.2');
    assert.equal(read('<=26.1.2'), '<=26.1.2');
    assert.equal(read('<26.1.2'), '<26.1.2');
    assert.equal(read('=26.1.2'), '=26.1.2');
    assert.equal(read('26.1.2'), '=26.1.2');
  });

  it('gives ^ and ~ the meaning that npm gives them', () => {
    assert.equal(read('^26.1.2'), '>=26.1.2 <27.0.0');
    assert.equal(read('^26.1'), '>=26.1.0 <27.0.0');
    assert.equal(read('^26'), '>=26.0.0 <27.0.0');
    assert.equal(read('~26.1.2'), '>=26.1.2 <26.2.0');
    assert.equal(read('~26.1'), '>=26.1.0 <26.2.0');
    assert.equal(read('~26'), '>=26.0.0 <27.0.0');
  });

  it('keeps ^ below the next minor or patch for a 0 major, as npm does', () => {
    assert.equal(read('^0.2.3'), '>=0.2.3 <0.3.0');
    assert.equal(read('^0.2'), '>=0.2.0 <0.3.0');
    assert.equal(read('^0.0.3'), '>=0.0.3 <0.0.4');
    assert.equal(read('^0.0'), '>=0.0.0 <0.1.0');
    assert.equal(read('^0'), '>=0.0.0 <1.0.0');
  });

  it('reads a version of one or two parts as npm does', () => {
    assert.equal(read('26'), '>=26.0.0 <27.0.0');
    assert.equal(read('=26'), '>=26.0.0 <27.0.0');
    assert.equal(read('26.1'), '>=26.1.0 <26.2.0');
    assert.equal(read('>=26'), '>=26.0.0');
    assert.equal(read('>26'), '>=27.0.0');
    assert.equal(read('>26.1'), '>=26.2.0');
    assert.equal(read('<26'), '<26.0.0');
    assert.equal(read('<=26'), '<27.0.0');
    assert.equal(read('<=26.1'), '<26.2.0');
  });

  it('reads comparators separated by spaces, a v, and a space after the operator', () => {
    assert.equal(read('  >= v26.1.0   <27 '), '>=26.1.0 <27.0.0');
    assert.equal(read('>=22.6.0 <27 ^26'), '>=22.6.0 <27.0.0 >=26.0.0 <27.0.0');
  });

  it('refuses each other form, and says why', () => {
    const refused = {
      '22 || 26': /"\|\|"/,
      '22 - 26': /hyphen range/,
      '*': /"\*" has a wildcard/,
      x: /"x" has a wildcard/,
      '26.x': /"26\.x" has a wildcard/,
      '26.X': /"26\.X" has a wildcard/,
      '>=26.*': /">=26\.\*" has a wildcard/,
      '26.0.0-rc.1': /prerelease tag/,
      '>=26.0.0-0': /prerelease tag/,
      '26.0.0+build.1': /build metadata/,
      '': /empty/,
      '   ': /empty/,
      latest: /"latest" is not a comparator/,
      '>=': /">=" is not a comparator/,
      '~>26': /"~>26" is not a comparator/,
    };
    for (const [text, reason] of Object.entries(refused)) assert.throws(() => parseRange(text), reason, text);
    assert.throws(() => parseRange(26), /not a string/);
  });
});

describe('satisfies', () => {
  it('holds when every comparator holds', () => {
    assert.ok(satisfies([26, 13, 0], parseRange('>=26.0.0 <27.0.0')));
    assert.ok(!satisfies([27, 0, 0], parseRange('>=26.0.0 <27.0.0')));
    assert.ok(!satisfies([25, 9, 9], parseRange('>=26.0.0 <27.0.0')));
  });

  it('gives each operator its bound, inclusive or not', () => {
    const at = [26, 13, 0];
    assert.ok(satisfies(at, parseRange('>=26.13.0')) && !satisfies(at, parseRange('>=26.13.1')));
    assert.ok(satisfies(at, parseRange('>26.12.9')) && !satisfies(at, parseRange('>26.13.0')));
    assert.ok(satisfies(at, parseRange('<=26.13.0')) && !satisfies(at, parseRange('<=26.12.9')));
    assert.ok(satisfies(at, parseRange('<26.13.1')) && !satisfies(at, parseRange('<26.13.0')));
    assert.ok(satisfies(at, parseRange('=26.13.0')) && !satisfies(at, parseRange('26.13.1')));
  });
});

describe('lowerBound', () => {
  it('is the highest of the >=, > and = bounds', () => {
    assert.deepEqual(lowerBound(parseRange('>=22.6.0 ^26.1 <28')), [26, 1, 0]);
    assert.deepEqual(lowerBound(parseRange('>26.0.0')), [26, 0, 0]);
    assert.deepEqual(lowerBound(parseRange('26.13.0')), [26, 13, 0]);
    assert.deepEqual(lowerBound(parseRange('~26 >=26.13.0')), [26, 13, 0]);
  });

  it('is null for a range with only upper bounds', () => {
    assert.equal(lowerBound(parseRange('<27 <=26.20')), null);
  });
});

describe('nodeRanges', () => {
  it('reads the devEngines object, and engines with the major rule only when asked', () => {
    assert.deepEqual(nodeRanges(TEMPLATE), {
      ranges: [
        { field: 'devEngines.runtime.version', text: '>=26.0.0', major: true },
        { field: 'engines.node', text: '>=26.0.0', major: false },
      ],
      skipped: [],
      problems: [],
    });
    assert.equal(nodeRanges(TEMPLATE, { enginesMajor: true }).ranges[1].major, true);
  });

  it('reads each node entry of a devEngines list, and no other runtime', () => {
    const manifest = { devEngines: { runtime: [{ name: 'bun', version: '>=1' }, null, { name: 'node', version: '^26' }, { name: 'node', version: '>=26.1' }] } };
    assert.deepEqual(nodeRanges(manifest).ranges, [
      { field: 'devEngines.runtime[2].version', text: '^26', major: true },
      { field: 'devEngines.runtime[3].version', text: '>=26.1', major: true },
    ]);
  });

  it('names each field that is not there', () => {
    assert.deepEqual(nodeRanges({}).skipped, ['devEngines.runtime', 'engines.node']);
    assert.deepEqual(nodeRanges({ devEngines: { runtime: [{ name: 'bun', version: '>=1' }] } }).skipped, [
      'devEngines.runtime entry with "name": "node"',
      'engines.node',
    ]);
    assert.deepEqual(nodeRanges({ devEngines: { runtime: { name: 'node' } }, engines: {} }).skipped, ['devEngines.runtime.version', 'engines.node']);
  });

  it('refuses a devEngines.runtime that is not an object or a list', () => {
    for (const runtime of ['node', null]) {
      const { ranges, problems } = nodeRanges({ devEngines: { runtime } });
      assert.equal(ranges.length, 0);
      assert.match(problems[0], /^devEngines\.runtime is .*\. Write an object such as/);
    }
  });
});

describe('rangeProblem', () => {
  const pinned = [26, 13, 0];

  it('is null for a range that accepts .nvmrc and starts on its major', () => {
    assert.equal(rangeProblem(pinned, { field: 'engines.node', text: '>=26.0.0', major: true }), null);
    assert.equal(rangeProblem(pinned, { field: 'engines.node', text: '^26.1 <26.20', major: true }), null);
  });

  it('names the forms that it reads, for a range that it cannot read', () => {
    const problem = rangeProblem(pinned, { field: 'engines.node', text: '>=22 || >=26', major: false });
    assert.ok(problem.startsWith('engines.node is ">=22 || >=26", which the check cannot read: it has "||"'));
    assert.ok(problem.includes(FORMS));
    assert.ok(problem.endsWith('For example ">=26.0.0".'));
  });

  it('asks for a range that accepts .nvmrc, with the major when the rule applies', () => {
    assert.match(
      rangeProblem(pinned, { field: 'engines.node', text: '>=27', major: false }),
      /^engines\.node is ">=27", which does not accept Node 26\.13\.0 from \.nvmrc\. Write a range that accepts it, or set \.nvmrc to a version in the range\.$/,
    );
    assert.match(
      rangeProblem(pinned, { field: 'devEngines.runtime.version', text: '<26', major: true }, 'node/.nvmrc'),
      /from node\/\.nvmrc\. Write a range that accepts it, with its lower bound on Node 26, for example ">=26\.0\.0"\.$/,
    );
  });

  it('asks for a lower bound on the major of .nvmrc, only when the rule applies', () => {
    assert.equal(rangeProblem(pinned, { field: 'engines.node', text: '>=22.6.0', major: false }), null);
    assert.equal(
      rangeProblem(pinned, { field: 'engines.node', text: '>=22.6.0', major: true }),
      'engines.node is ">=22.6.0", whose lower bound is on Node 22, but .nvmrc pins Node 26.13.0. Raise the lower bound to Node 26, for example ">=26.0.0".',
    );
  });

  it('asks for a lower bound when the range has none, and the rule applies', () => {
    assert.equal(rangeProblem(pinned, { field: 'engines.node', text: '<27', major: false }), null);
    assert.equal(
      rangeProblem(pinned, { field: 'devEngines.runtime.version', text: ' <27 ', major: true }),
      'devEngines.runtime.version is " <27 ", which has no lower bound, so it does not say which Node major it is for. ' +
        'Give it a lower bound on Node 26, for example ">=26.0.0 <27".',
    );
  });
});

describe('annotation', () => {
  it('escapes the file and the message as the workflow-command syntax requires', () => {
    assert.equal(annotation('error', 'a,b:c.json', '50% done\r\nnext'), '::error file=a%2Cb%3Ac.json::50%25 done%0D%0Anext');
    assert.equal(annotation('notice', 'package.json', 'plain'), '::notice file=package.json::plain');
  });
});

describe('check', () => {
  it('passes repo-template, and names what it compared', () => {
    assert.deepEqual(check([26, 13, 0], TEMPLATE, { enginesMajor: true }), {
      lines: ['.nvmrc (26.13.0) agrees with devEngines.runtime.version ">=26.0.0" (range and major) and engines.node ">=26.0.0" (range and major).'],
      code: 0,
    });
  });

  it('passes a library whose engines is older than .nvmrc, and fails it with --engines-major', () => {
    const library = check([26, 13, 0], LIBRARY);
    assert.equal(library.code, 0);
    assert.deepEqual(library.lines, [
      '::notice file=package.json::package.json has no devEngines.runtime, so the check skips it.',
      '.nvmrc (26.13.0) agrees with engines.node ">=22.6.0" (range).',
    ]);
    const app = check([26, 13, 0], LIBRARY, { enginesMajor: true });
    assert.equal(app.code, 1);
    assert.match(app.lines[1], /^::error file=package\.json::engines\.node is ">=22\.6\.0", whose lower bound is on Node 22/);
  });

  it('fails when .nvmrc moves to the next major and devEngines stays behind', () => {
    const { lines, code } = check([28, 0, 0], TEMPLATE);
    assert.equal(code, 1);
    assert.deepEqual(lines, [
      '::error file=package.json::devEngines.runtime.version is ">=26.0.0", whose lower bound is on Node 26, but .nvmrc pins Node 28.0.0. ' +
        'Raise the lower bound to Node 28, for example ">=28.0.0".',
    ]);
  });

  it('reports each failure, after the notices', () => {
    const manifest = { devEngines: { runtime: [{ name: 'node', version: '26.x' }, { name: 'node' }] }, engines: { node: '<26' } };
    const { lines, code } = check([26, 13, 0], manifest, { nvmrc: 'app/.nvmrc', packageJson: 'app/package.json' });
    assert.equal(code, 1);
    assert.equal(lines.length, 3);
    assert.equal(lines[0], '::notice file=app/package.json::app/package.json has no devEngines.runtime[1].version, so the check skips it.');
    assert.match(lines[1], /^::error file=app\/package\.json::devEngines\.runtime\[0\]\.version is "26\.x", which the check cannot read/);
    assert.match(lines[2], /^::error file=app\/package\.json::engines\.node is "<26", which does not accept Node 26\.13\.0 from app\/\.nvmrc/);
  });

  it('fails a devEngines.runtime of the wrong shape, and still compares engines', () => {
    const { lines, code } = check([26, 13, 0], { devEngines: { runtime: 'node' }, engines: { node: '>=27' } });
    assert.equal(code, 1);
    assert.match(lines[0], /^::error file=package\.json::devEngines\.runtime is "node"/);
    assert.match(lines[1], /^::error file=package\.json::engines\.node is ">=27"/);
  });

  it('passes a package.json with no Node range, with a notice for each field', () => {
    assert.deepEqual(check([26, 13, 0], {}), {
      lines: [
        '::notice file=package.json::package.json has no devEngines.runtime, so the check skips it.',
        '::notice file=package.json::package.json has no engines.node, so the check skips it.',
        'package.json gives no Node range to compare with .nvmrc (26.13.0).',
      ],
      code: 0,
    });
  });
});

describe('run', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'node-version-'));
  after(() => rmSync(scratch, { recursive: true, force: true }));

  /** A directory with each of `files`, as name to text. */
  function project(name, files) {
    const dir = path.join(scratch, name);
    mkdirSync(dir, { recursive: true });
    for (const [file, text] of Object.entries(files)) writeFileSync(path.join(dir, file), text);
    return dir;
  }

  it('reads the two files, and passes --engines-major to the check', () => {
    const dir = project('library', { '.nvmrc': '26.13.0\n', 'package.json': JSON.stringify(LIBRARY) });
    assert.equal(run(dir).code, 0);
    assert.equal(run(dir, { enginesMajor: true }).code, 1);
  });

  it('reads the files from the paths that it is given', () => {
    const dir = project('paths', { 'node-version': 'v26.13.0', 'manifest.json': JSON.stringify(TEMPLATE) });
    const { lines, code } = run(dir, { nvmrc: 'node-version', packageJson: 'manifest.json', enginesMajor: true });
    assert.equal(code, 0);
    assert.match(lines[0], /^node-version \(26\.13\.0\) agrees with devEngines/);
  });

  it('fails on each file that is not there, and says what to do', () => {
    const { lines, code } = run(project('empty', {}));
    assert.equal(code, 1);
    assert.deepEqual(lines, [
      '::error file=.nvmrc::.nvmrc does not exist. Write the exact Node version in it, as x.y.z, or give its path with nvmrc.',
      '::error file=package.json::package.json does not exist. Run the check where package.json is, or give its path with package-json.',
    ]);
  });

  it('fails on a .nvmrc that is not an exact version', () => {
    const { lines, code } = run(project('lts', { '.nvmrc': 'lts/*\n', 'package.json': '{}' }));
    assert.equal(code, 1);
    assert.deepEqual(lines, ['::error file=.nvmrc::.nvmrc must hold one exact x.y.z version, found "lts/*".']);
  });

  it('fails on a package.json that is not a JSON object', () => {
    for (const [name, text, problem] of [
      ['broken', '{', /^::error file=package\.json::package\.json is not valid JSON: /],
      ['list', '[]', /^::error file=package\.json::package\.json must hold a JSON object\.$/],
      ['null', 'null', /^::error file=package\.json::package\.json must hold a JSON object\.$/],
    ]) {
      const { lines, code } = run(project(name, { '.nvmrc': '26.13.0', 'package.json': text }));
      assert.equal(code, 1, name);
      assert.match(lines[0], problem, name);
    }
  });

  it('fails on a path that it cannot read', () => {
    const dir = project('directory', { 'package.json': '{}' });
    mkdirSync(path.join(dir, '.nvmrc'));
    const { lines, code } = run(dir);
    assert.equal(code, 1);
    assert.match(lines[0], /^::error file=\.nvmrc::\.nvmrc cannot be read: EISDIR/);
  });
});
