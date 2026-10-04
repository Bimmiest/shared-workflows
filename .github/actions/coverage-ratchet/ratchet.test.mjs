import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { measure, problems, report, thresholdsFromConfig, thresholdsFromText } from './ratchet.mjs';

const entry = (covered, total) =>
  Object.fromEntries(['statements', 'branches', 'functions', 'lines'].map((m) => [m, { covered, total, pct: (100 * covered) / total }]));

const root = '/repo';
const summary = {
  total: entry(90, 100),
  [`${root}/src/engine/a.ts`]: entry(50, 50),
  [`${root}/src/ui/b.ts`]: entry(40, 50),
};

describe('measure', () => {
  it('sums covered over total across the selected files, skipping the total row', () => {
    assert.equal(measure(summary).lines, 90);
    assert.equal(measure(summary, (f) => f.includes('/engine/')).lines, 100);
    assert.equal(measure(summary, (f) => f.includes('/ui/')).lines, 80);
  });

  it('is null when nothing is selected', () => {
    assert.equal(measure(summary, () => false).lines, null);
  });
});

describe('problems', () => {
  it('passes a floor within the slack of its measurement', () => {
    assert.deepEqual(problems({ statements: 90, branches: 89, functions: 90, lines: 90 }, summary, { root }), []);
  });

  it('reports a floor more than slack under the measurement, with the floor to write', () => {
    const [p] = problems({ statements: 90, branches: 90, functions: 90, lines: 85 }, summary, { root });
    assert.equal(p.kind, 'stale');
    assert.equal(p.metric, 'lines');
    assert.equal(p.raise, 90);
  });

  it('reports a floor above the measurement', () => {
    const found = problems({ lines: 95 }, summary, { root });
    assert.equal(found[0].kind, 'under');
  });

  it('checks per-glob thresholds against the files the glob matches, relative to the root', () => {
    const found = problems({ lines: 90, 'src/engine/**': { lines: 100 }, 'src/ui/**': { lines: 70 } }, summary, { root });
    assert.deepEqual(
      found.map((p) => [p.scope, p.kind]),
      [['src/ui/**', 'stale']],
    );
  });

  it('reports a glob that matches nothing instead of passing it', () => {
    const [p] = problems({ 'src/nowhere/**': { lines: 50 } }, summary, { root });
    assert.equal(p.kind, 'empty');
  });

  it('ignores vitest options that are not floors', () => {
    assert.deepEqual(problems({ autoUpdate: true, perFile: false, lines: 90 }, summary, { root }), []);
  });

  it('honours a wider slack', () => {
    assert.deepEqual(problems({ lines: 87 }, summary, { root, slack: 3 }), []);
    assert.equal(problems({ lines: 87 }, summary, { root, slack: 1 }).length, 1);
  });
});

describe('report', () => {
  it('exits 0 with a table when every floor is current', () => {
    const { code, lines } = report({ lines: 90 }, summary, { root });
    assert.equal(code, 0);
    assert.match(lines.join('\n'), /lines\s+measured\s+90\.00%\s+floor 90%/);
  });

  it('exits 1 with an annotation per problem and the block to paste', () => {
    const { code, lines } = report({ statements: 85, lines: 85 }, summary, { root });
    assert.equal(code, 1);
    assert.equal(lines.filter((l) => l.startsWith('::error::')).length, 2);
    assert.ok(lines.includes('        statements: 90,'));
    assert.ok(lines.includes('        lines: 90,'));
  });
});

describe('thresholdsFromText', () => {
  it('reads the top-level numbers of the first thresholds block', () => {
    const source = `export default defineConfig({ test: { coverage: { thresholds: {\n statements: 92, // measured\n branches: 86,\n functions: 91,\n lines: 94,\n } } } });`;
    assert.deepEqual(thresholdsFromText(source), { statements: 92, branches: 86, functions: 91, lines: 94 });
  });

  it('throws when there is no block', () => {
    assert.throws(() => thresholdsFromText('export default {}'), /No `thresholds/);
  });
});

describe('thresholdsFromConfig', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ratchet-'));

  it('imports a default-export object', async () => {
    const file = path.join(dir, 'object.config.mjs');
    writeFileSync(file, 'export default { test: { coverage: { thresholds: { lines: 80, "src/**": { lines: 90 } } } } };');
    assert.deepEqual(await thresholdsFromConfig(file), { lines: 80, 'src/**': { lines: 90 } });
  });

  it('calls a default-export function', async () => {
    const file = path.join(dir, 'function.config.mjs');
    writeFileSync(file, 'export default () => ({ test: { coverage: { thresholds: { lines: 70 } } } });');
    assert.deepEqual(await thresholdsFromConfig(file), { lines: 70 });
  });

  it('strips types from a .ts config', async () => {
    const file = path.join(dir, 'typed.config.ts');
    writeFileSync(file, 'const floor: number = 75;\nexport default { test: { coverage: { thresholds: { lines: floor } } } };');
    assert.deepEqual(await thresholdsFromConfig(file), { lines: 75 });
  });

  it('refuses a config with no thresholds', async () => {
    const file = path.join(dir, 'none.config.mjs');
    writeFileSync(file, 'export default { test: {} };');
    await assert.rejects(() => thresholdsFromConfig(file), /declares no test.coverage.thresholds/);
  });
});
