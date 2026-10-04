import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { advisories, check, exceptionProblems, gatedSeverities } from './audit-check.mjs';

const advisory = (name, severity, ghsa) => ({
  source: 1,
  name,
  severity,
  title: `${name} does something bad`,
  url: `https://github.com/advisories/${ghsa}`,
});

const report = (vulnerabilities) => ({ vulnerabilities });
const TODAY = '2026-10-04';

describe('gatedSeverities', () => {
  it('includes the level and everything above it', () => {
    assert.deepEqual([...gatedSeverities('high')], ['high', 'critical']);
    assert.deepEqual([...gatedSeverities('moderate')], ['moderate', 'high', 'critical']);
    assert.throws(() => gatedSeverities('severe'), /Unknown audit level/);
  });
});

describe('advisories', () => {
  it('reads advisory objects once each and skips inherited bare names', () => {
    const a = advisory('left-pad', 'high', 'GHSA-aaaa-bbbb-cccc');
    const found = advisories(report({ 'left-pad': { via: [a] }, consumer: { via: ['left-pad'] }, other: { via: [a] } }));
    assert.deepEqual(found, [{ id: 'GHSA-aaaa-bbbb-cccc', package: 'left-pad', severity: 'high', title: a.title, url: a.url }]);
  });

  it('falls back to the numeric source when the url carries no GHSA', () => {
    const [found] = advisories(report({ x: { via: [{ source: 42, name: 'x', severity: 'low', title: 't', url: 'https://example.invalid' }] } }));
    assert.equal(found.id, '42');
  });
});

describe('exceptionProblems', () => {
  it('names every missing field', () => {
    const out = exceptionProblems([{ id: 'GHSA-aaaa-bbbb-cccc' }], TODAY);
    assert.equal(out.length, 3);
    assert.match(out[0], /has no `package`/);
  });

  it('refuses a malformed or expired date', () => {
    const base = { id: 'GHSA-aaaa-bbbb-cccc', package: 'p', reason: 'r' };
    assert.match(exceptionProblems([{ ...base, expires: 'soon' }], TODAY)[0], /not a YYYY-MM-DD date/);
    assert.match(exceptionProblems([{ ...base, expires: '2026-10-03' }], TODAY)[0], /expired on 2026-10-03/);
    assert.deepEqual(exceptionProblems([{ ...base, expires: '2026-10-04' }], TODAY), []);
  });
});

describe('check', () => {
  const high = advisory('left-pad', 'high', 'GHSA-aaaa-bbbb-cccc');
  const low = advisory('tiny', 'low', 'GHSA-dddd-eeee-ffff');

  it('passes a clean report, counting what sits below the floor', () => {
    const { code, lines } = check(report({ tiny: { via: [low] } }), {}, { today: TODAY });
    assert.equal(code, 0);
    assert.match(lines[0], /1 below the floor, not gated/);
  });

  it('fails a gated advisory with the remedy', () => {
    const { code, lines } = check(report({ 'left-pad': { via: [high] } }), {}, { today: TODAY });
    assert.equal(code, 1);
    assert.match(lines[0], /^::error::high GHSA-aaaa-bbbb-cccc in left-pad/);
    assert.match(lines[0], /Upgrade past it/);
  });

  it('accepts an excepted advisory and says so', () => {
    const exceptions = { exceptions: [{ id: 'GHSA-aaaa-bbbb-cccc', package: 'left-pad', reason: 'not reachable', expires: '2027-01-01' }] };
    const { code, lines } = check(report({ 'left-pad': { via: [high] } }), exceptions, { today: TODAY });
    assert.equal(code, 0);
    assert.match(lines[0], /beyond the 1 excepted/);
  });

  it('fails an exception the report no longer needs', () => {
    const exceptions = { exceptions: [{ id: 'GHSA-aaaa-bbbb-cccc', package: 'left-pad', reason: 'r', expires: '2027-01-01' }] };
    const { code, lines } = check(report({}), exceptions, { today: TODAY });
    assert.equal(code, 1);
    assert.match(lines[0], /which the report no longer contains. Remove it/);
  });

  it('matches an exception on both id and package', () => {
    const exceptions = { exceptions: [{ id: 'GHSA-aaaa-bbbb-cccc', package: 'other', reason: 'r', expires: '2027-01-01' }] };
    const { code } = check(report({ 'left-pad': { via: [high] } }), exceptions, { today: TODAY });
    assert.equal(code, 1);
  });

  it('gates at the level it is given', () => {
    const { code } = check(report({ tiny: { via: [low] } }), {}, { today: TODAY, gated: gatedSeverities('low') });
    assert.equal(code, 1);
  });

  it('reports an npm audit error as its own failure', () => {
    const { code, lines } = check({ error: { code: 'ENOLOCK', summary: 'no lockfile' } }, {}, { today: TODAY });
    assert.equal(code, 1);
    assert.match(lines[0], /npm audit failed: no lockfile/);
  });
});
