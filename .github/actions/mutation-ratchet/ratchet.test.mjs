import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it, mock } from 'node:test';
import { DEFAULT_SLACK, main, readShards, verdict } from './ratchet.mjs';

const mutants = (counts) => Object.entries(counts).flatMap(([status, n]) => Array.from({ length: n }, () => ({ status })));
const report = (files) => ({ schemaVersion: '2', thresholds: { high: 80, low: 60 }, files });

describe('verdict', () => {
  it('passes a score within the slack above its floor, and at the floor', () => {
    assert.deepEqual(verdict({ killed: 905, total: 1000, score: 90.5 }, 90), {
      lines: ['The mutation score is 90.50% (905 of 1000 mutants detected), within 1 point(s) above its floor of 90% in stryker.config.mjs.'],
      code: 0,
    });
    assert.equal(verdict({ killed: 9, total: 10, score: 90 }, 90).code, 0);
    assert.equal(DEFAULT_SLACK, 1);
  });

  it('fails a score more than the slack above its floor, and gives the floor to write', () => {
    const { lines, code } = verdict({ killed: 929, total: 1000, score: 92.9 }, 90, { config: 's.mjs' });
    assert.equal(code, 1);
    assert.equal(
      lines[0],
      '::error file=s.mjs::The mutation score is 92.90% (929 of 1000 mutants detected), more than 1 point(s) above its floor of 90% in s.mjs. Raise thresholds.break to 92.',
    );
    assert.equal(lines.at(-1), '  thresholds: { …, break: 92 },');
  });

  it('takes a larger slack', () => {
    assert.equal(verdict({ killed: 929, total: 1000, score: 92.9 }, 90, { slack: 3 }).code, 0);
  });

  it('fails a score under its floor', () => {
    assert.deepEqual(verdict({ killed: 8, total: 10, score: 80 }, 81).lines, [
      '::error file=stryker.config.mjs::The mutation score is 80.00% (8 of 10 mutants detected), under its floor of 81% in stryker.config.mjs. Add tests that kill the mutants that survived.',
    ]);
  });

  it('fails when there is no floor, or no mutant counts', () => {
    assert.match(verdict({ killed: 1, total: 1, score: 100 }, null).lines[0], /thresholds\.break in stryker\.config\.mjs is null/);
    assert.match(verdict({ killed: 0, total: 0, score: null }, 80).lines[0], /No mutant in the report counts/);
  });
});

const scratch = mkdtempSync(path.join(tmpdir(), 'mutation-ratchet-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** Writes `files` under a new directory in the scratch directory, and gives its path. */
let next = 0;
function project(files) {
  const dir = path.join(scratch, String((next += 1)));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

describe('readShards', () => {
  it('merges the shard reports, and gives a table of each shard and of all', () => {
    const dir = project({
      'm-2-of-2/mutation.json': report({ 'b.ts': { mutants: mutants({ Killed: 1, Survived: 1 }) } }),
      'm-1-of-2/mutation.json': report({ 'a.ts': { mutants: mutants({ Killed: 3, Ignored: 2 }) } }),
    });
    const { files, table } = readShards(dir, 'm');
    assert.deepEqual(Object.keys(files), ['a.ts', 'b.ts']);
    assert.deepEqual(table.slice(2), ['| 1 of 2 | 1 | 3 | 3 | 100.00% |', '| 2 of 2 | 1 | 1 | 2 | 50.00% |', '| All | 2 | 4 | 5 | 80.00% |']);
  });

  it('gives n/a for a shard with no mutant that counts', () => {
    const dir = project({ 'mutation-report-1-of-1/mutation.json': report({}) });
    assert.equal(readShards(dir).table[2], '| 1 of 1 | 0 | 0 | 0 | n/a |');
  });

  it('refuses a shard directory with no mutation.json, and a missing shard', () => {
    assert.throws(() => readShards(project({ 'mutation-report-1-of-1/other.json': {} })), /mutation-report-1-of-1 has no mutation\.json/);
    assert.throws(() => readShards(project({ 'mutation-report-2-of-2/mutation.json': report({}) })), /no report from shard 1 of 2/);
  });
});

describe('main', () => {
  let printed;
  beforeEach(() => {
    printed = [];
    mock.method(console, 'log', (line) => printed.push(line));
  });
  after(() => mock.restoreAll());

  const config = (floor) => `import x from 'not-installed';\nexport default { thresholds: { high: 95, break: process.env.MUTATION_SHARD === '1' ? null : ${floor} } };\n`;
  const at = (dir, file) => path.join(dir, file);

  it('passes a report within the slack of the floor, with a config that it cannot import', () => {
    const dir = project({ 's.mjs': config(80), 'r.json': report({ 'a.ts': { mutants: mutants({ Killed: 4, Survived: 1 }) } }) });
    assert.equal(main(['--report', at(dir, 'r.json'), '--config', at(dir, 's.mjs')]), 0, printed.join('\n'));
    assert.match(printed[0], /^The mutation score is 80\.00%/);
  });

  it('fails a report well above the floor, and takes the slack', () => {
    const dir = project({ 's.mjs': config(70), 'r.json': report({ 'a.ts': { mutants: mutants({ Killed: 4, Survived: 1 }) } }) });
    assert.equal(main(['--report', at(dir, 'r.json'), '--config', at(dir, 's.mjs')]), 1);
    assert.match(printed[0], /Raise thresholds\.break to 80\.$/);
    assert.equal(main(['--report', at(dir, 'r.json'), '--config', at(dir, 's.mjs'), '--slack', '10']), 0);
  });

  it('merges the shard reports, and writes their table to the summary', () => {
    const dir = project({
      's.mjs': config(75),
      'shards/m-1-of-2/mutation.json': report({ 'a.ts': { mutants: mutants({ Killed: 3 }) } }),
      'shards/m-2-of-2/mutation.json': report({ 'b.ts': { mutants: mutants({ Survived: 1 }) } }),
    });
    const summary = at(dir, 'summary.md');
    assert.equal(main(['--shards', at(dir, 'shards'), '--prefix', 'm', '--config', at(dir, 's.mjs'), '--summary', summary]), 0, printed.join('\n'));
    assert.match(readFileSync(summary, 'utf8'), /\| All \| 2 \| 3 \| 4 \| 75\.00% \|\n\n$/);
  });

  it('prints the table when there is no summary file', () => {
    const dir = project({ 's.mjs': config(75), 'shards/mutation-report-1-of-1/mutation.json': report({ 'a.ts': { mutants: mutants({ Killed: 3, Survived: 1 }) } }) });
    const write = mock.method(process.stdout, 'write', () => true);
    assert.equal(main(['--shards', at(dir, 'shards'), '--config', at(dir, 's.mjs')]), 0);
    write.mock.restore();
    assert.match(write.mock.calls[0].arguments[0], /\| All \| 1 \| 3 \| 4 \| 75\.00% \|/);
  });

  it('fails a file in two shards', () => {
    const dir = project({
      's.mjs': config(75),
      'shards/mutation-report-1-of-2/mutation.json': report({ 'a.ts': { mutants: mutants({ Killed: 3 }) } }),
      'shards/mutation-report-2-of-2/mutation.json': report({ 'a.ts': { mutants: mutants({ Survived: 1 }) } }),
    });
    assert.equal(main(['--shards', at(dir, 'shards'), '--config', at(dir, 's.mjs')]), 1);
    assert.deepEqual(printed, ['::error::a.ts is in two shard reports. Each file must be in one shard only.']);
  });

  it('says what to change when an input is wrong', () => {
    const dir = project({ 's.mjs': config(80), 'odd.mjs': 'export default { thresholds: { break: f(1, 2) } }' });
    const cases = [
      [['--slack', 'x'], /slack is "x"/],
      [['--slack', ' '], /slack is " "/],
      [['--slack=-1'], /slack is "-1"/],
      [['--config', at(dir, 'none.mjs')], /No Stryker config at/],
      [['--config', at(dir, 'odd.mjs')], /is `f\(1, 2\)`, which the scripts cannot read/],
      [['--config', at(dir, 's.mjs'), '--report', at(dir, 'none.json')], /No mutation report at .*none\.json\. Add 'json' to the reporters/],
      [['--config', at(dir, 's.mjs'), '--shards', at(dir, 'none')], /^::error::There is no directory .*none\. Download/],
    ];
    for (const [args, message] of cases) {
      printed = [];
      assert.equal(main(args), 1, args.join(' '));
      assert.match(printed[0], message, args.join(' '));
    }
  });
});
