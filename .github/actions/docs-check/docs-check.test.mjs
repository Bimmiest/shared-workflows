import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { adrProblems, brokenLinks, gapNotes, indexRows, lengthProblems, licenceProblems, links, readmeLengthProblem, resolveTarget, run, steWarnings, stripCode } from './docs-check.mjs';

describe('stripCode', () => {
  it('blanks fenced blocks and inline spans, keeping line numbers', () => {
    const text = 'a [x](y)\n```\n[code](link)\n```\nb `[span](link)` c [real](z)';
    const out = stripCode(text).split('\n');
    assert.equal(out.length, 5);
    assert.equal(out[2], '');
    assert.ok(!out[4].includes('[span]'));
    assert.ok(out[4].includes('[real](z)'));
  });

  it('closes a fence only with the same character and at least the same length', () => {
    const text = '````\n```\nstill code [x](y)\n````\nout [a](b)';
    const out = stripCode(text);
    assert.ok(!out.includes('still code'));
    assert.ok(out.includes('[a](b)'));
  });
});

describe('links', () => {
  it('finds inline links, images with titles, angle-bracket targets and reference definitions', () => {
    const text = '[a](x.md) ![i](img.png "t") [b](<with space.md>)\n[ref]: ./r.md\n  [r2]: <other.md>';
    assert.deepEqual(
      links(text).map((l) => l.target),
      ['x.md', 'img.png', 'with space.md', './r.md', 'other.md'],
    );
  });
});

describe('resolveTarget', () => {
  it('resolves relative to the file, root-relative from the repository, and ignores URLs and anchors', () => {
    assert.equal(resolveTarget('docs/a.md', '../README.md'), 'README.md');
    assert.equal(resolveTarget('docs/a.md', 'b.md#section'), 'docs/b.md');
    assert.equal(resolveTarget('docs/a.md', '/LICENSE'), 'LICENSE');
    assert.equal(resolveTarget('docs/a.md', 'https://example.com/x'), null);
    assert.equal(resolveTarget('docs/a.md', 'mailto:x@example.com'), null);
    assert.equal(resolveTarget('docs/a.md', '#here'), null);
    assert.equal(resolveTarget('docs/a.md', '//cdn/x'), null);
    assert.equal(resolveTarget('docs/a.md', 'a%20b.md'), 'docs/a b.md');
  });
});

describe('brokenLinks', () => {
  const exists = (p) => ['README.md', 'docs/adr/0001-a.md'].includes(p);

  it('reports a link that does not resolve, with its line', () => {
    const files = [{ file: 'README.md', text: 'ok [a](docs/adr/0001-a.md)\nbad [b](missing.md)' }];
    const broken = brokenLinks(files, exists);
    assert.deepEqual([...broken], [{ file: 'README.md', line: 2, target: 'missing.md' }]);
    assert.deepEqual(broken.stale, []);
  });

  it('treats a link that climbs out of the repository as broken', () => {
    const [b] = brokenLinks([{ file: 'README.md', text: '[x](../outside.md)' }], exists);
    assert.equal(b.target, '../outside.md');
  });

  it('skips a known dead link only in an ADR record, and flags a stale entry', () => {
    const known = [
      { file: 'docs/adr/0002-b.md', target: './0001-old-name.md', reason: 'renamed' },
      { file: 'docs/adr/0003-c.md', target: './gone.md', reason: 'stale' },
    ];
    const files = [
      { file: 'docs/adr/0002-b.md', text: '[x](./0001-old-name.md)' },
      { file: 'docs/adr/0003-c.md', text: 'no link any more' },
      { file: 'docs/guide.md', text: '[x](./0001-old-name.md)' },
    ];
    const broken = brokenLinks(files, exists, { known });
    assert.deepEqual([...broken], [{ file: 'docs/guide.md', line: 1, target: './0001-old-name.md' }]);
    assert.deepEqual(broken.stale, [known[1]]);
  });
});

describe('the ADR index', () => {
  const readme = (rows, gaps = '') => `# ADRs\n\n## Index\n\n| # | Decision | Status |\n|---|---|---|\n${rows}\n\n## Numbers with no record\n\n${gaps}\n`;

  it('reads rows and gap notes, including ranges', () => {
    assert.deepEqual(
      indexRows(readme('| [0001](0001-a.md) | A | Accepted |\n| [0003](0003-c.md) | C | Accepted |')).map((r) => r.number),
      [1, 3],
    );
    const notes = gapNotes(readme('', '- **2**: reserved and never written.\n- **5–6** — merged into 4.'));
    assert.deepEqual([...notes.keys()], [2, 5, 6]);
    assert.equal(notes.get(2).reason, 'reserved and never written.');
  });

  it('passes a complete, ordered index whose gaps are explained', () => {
    const text = readme('| [0001](0001-a.md) | A | Accepted |\n| [0003](0003-c.md) | C | Accepted |', '- **2**: reserved and never written.');
    assert.deepEqual(adrProblems(['0001-a.md', '0003-c.md', 'README.md'], text), []);
  });

  it('names every disagreement between the directory and the index', () => {
    const text = readme('| [0003](0003-c.md) | C | Accepted |\n| [0001](0001-wrong.md) | A | Accepted |\n| [0009](0009-z.md) | Z | Accepted |');
    const problems = adrProblems(['0001-a.md', '0003-c.md', '0004-d.md'], text);
    assert.ok(problems.some((p) => p.includes('0004-d.md has no row')));
    assert.ok(problems.some((p) => p.includes('links 0001-wrong.md, but the file is 0001-a.md')));
    assert.ok(problems.some((p) => p.includes('ADR 1 comes after 3')));
    assert.ok(problems.some((p) => p.includes('ADR 9 names no file')));
    assert.ok(problems.some((p) => p.includes('ADR 2 is missing from the sequence')));
  });

  it('refuses a gap note with no reason, and one for a number that has a file', () => {
    const text = readme('| [0001](0001-a.md) | A | Accepted |\n| [0003](0003-c.md) | C | Accepted |', '- **2**\n- **3**: nope.');
    const problems = adrProblems(['0001-a.md', '0003-c.md'], text);
    assert.ok(problems.some((p) => p.includes('the note for ADR 2 gives no reason')));
    assert.ok(problems.some((p) => p.includes('ADR 3 is noted as having no record, but it has one')));
  });

  it('refuses two files for one number', () => {
    const problems = adrProblems(['0001-a.md', '0001-b.md'], readme('| [0001](0001-a.md) | A | Accepted |'));
    assert.ok(problems.some((p) => p.includes('ADR 1 has two files')));
  });
});

describe('licenceProblems', () => {
  it('asks for every root LICENSE-* the README does not link', () => {
    const out = licenceProblems(['LICENSE', 'LICENSE-FONT', 'LICENSE-DATA', 'README.md'], 'See [the font licence](LICENSE-FONT).');
    assert.deepEqual(out, ['README.md links no `LICENSE-DATA`. Add it to the licence section, with what it covers and what it obliges.']);
  });
});

describe('readmeLengthProblem', () => {
  it('counts lines without the trailing newline, and passes at the limit', () => {
    assert.equal(readmeLengthProblem('a\nb\nc\n', 3), null);
    assert.match(readmeLengthProblem('a\nb\nc\nd\n', 3), /^README\.md is 4 lines, over the limit of 3 \(readmeMaxLines\)/);
  });

  it('refuses a limit that is not a positive whole number, so a typo cannot switch the check off', () => {
    for (const bad of [0, -5, 2.5, '200', null]) assert.match(readmeLengthProblem('a\n', bad), /must be a positive whole number/);
  });
});

describe('lengthProblems', () => {
  const lines = (n) => 'x\n'.repeat(n);
  const rules = [
    { glob: 'CHANGELOG.md', max: null },
    { glob: 'CONTRIBUTING.md', max: 3, hint: 'Keep the rules here.' },
    { glob: '**/*.md', max: 5 },
  ];
  const today = '2026-10-28';
  const check = (files, exceptions) => lengthProblems(files, rules, exceptions, today);
  const entry = { file: 'CONTRIBUTING.md', max: 6, reason: 'being split', issue: '#1', expires: '2026-12-31' };

  it('holds each file to the first rule that matches it, root files included, and exempts a null max', () => {
    const result = check([
      { file: 'CHANGELOG.md', text: lines(99) },
      { file: 'CONTRIBUTING.md', text: lines(3) },
      { file: 'README.md', text: lines(5) },
      { file: 'docs/a/b.md', text: lines(5) },
    ]);
    assert.deepEqual([...result], []);
    assert.equal(result.checked, 3);
  });

  it('names the file, the count, the rule and its hint, or the default advice', () => {
    const result = check([{ file: 'CONTRIBUTING.md', text: lines(4) }, { file: 'docs/a.md', text: lines(6) }]);
    assert.deepEqual(result.map((p) => p.file), ['CONTRIBUTING.md', 'docs/a.md']);
    assert.equal(result[0].problem, 'CONTRIBUTING.md is 4 lines, over the limit of 3 for `CONTRIBUTING.md` (maxLines). Keep the rules here.');
    assert.match(result[1].problem, /over the limit of 5 for `\*\*\/\*\.md` \(maxLines\)\. Split it, or move the detail/);
  });

  it('lets an exception carry a file up to its own cap, and no further', () => {
    const within = check([{ file: 'CONTRIBUTING.md', text: lines(6) }], [entry]);
    assert.deepEqual([...within], []);
    assert.equal(within.excepted, 1);
    assert.match(check([{ file: 'CONTRIBUTING.md', text: lines(7) }], [entry])[0].problem, /over its maxLinesExceptions cap of 6\. The exception stops it from growing/);
  });

  it('fails an exception that expired, that the file no longer needs, or that names no limited file', () => {
    assert.match(check([{ file: 'CONTRIBUTING.md', text: lines(6) }], [{ ...entry, expires: '2026-10-27' }])[0].problem, /expired on 2026-10-27/);
    assert.match(check([{ file: 'CONTRIBUTING.md', text: lines(2) }], [entry])[0].problem, /is no longer needed\. Remove the entry\./);
    assert.match(check([{ file: 'CHANGELOG.md', text: lines(9) }], [{ ...entry, file: 'CHANGELOG.md' }])[0].problem, /no Markdown file there is held to a limit/);
  });

  it('fails a malformed rule or exception rather than skipping it', () => {
    for (const bad of [undefined, [], 'x']) assert.match(lengthProblems([], bad)[0].problem, /maxLines must be a list/);
    assert.match(lengthProblems([], [{ glob: '*.md', max: 0 }])[0].problem, /maxLines\[0\] must have/);
    for (const bad of [{ ...entry, reason: '' }, { ...entry, max: '6' }, { ...entry, expires: '31/12/2026' }]) {
      assert.match(check([], [bad])[0].problem, /maxLinesExceptions\[0\] needs a file/);
    }
  });
});

describe('steWarnings', () => {
  it('finds each word that STE does not allow, on its line', () => {
    const text = 'You should run it.\nIt may fail, or it might.\nThat would help.\nTools, e.g. npm, i.e. this, etc.\nDon\'t do it. It\'s late, and they\'re here.\nOne; two.\n';
    assert.deepEqual(
      steWarnings(text).map(({ line, word }) => `${line}:${word}`),
      ['1:should', '2:may', '2:might', '3:would', '4:e.g.', '4:i.e.', '4:etc.', "5:Don't", "5:It's", "5:they're", '6:;'],
    );
  });

  it('ignores code, comments, tags, entities, URLs and possessives', () => {
    const text = [
      'Run `npm test; it should pass`.',
      '```bash',
      'a; b # would',
      '```',
      '<!-- This may change. -->',
      '<img alt="x" src="a;b">',
      'Tom &amp; Jerry, [link](https://x.test/should;may) and https://y.test/a;b.',
      "GitHub's README is the maintainers' file.",
    ].join('\n');
    assert.deepEqual(steWarnings(text), []);
  });

  it('gives the advice for the word', () => {
    assert.match(steWarnings('It should.')[0].advice, /"must"/);
  });
});

describe('run', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'docs-check-'));
  mkdirSync(path.join(root, 'docs/adr'), { recursive: true });
  mkdirSync(path.join(root, 'node_modules/pkg'), { recursive: true });
  writeFileSync(path.join(root, 'node_modules/pkg/README.md'), '[never read](nowhere.md)');
  writeFileSync(path.join(root, 'README.md'), '# Repo\n\n[ADRs](docs/adr/README.md) and [licence](LICENSE-EXTRA)\n');
  writeFileSync(path.join(root, 'LICENSE-EXTRA'), 'x');
  writeFileSync(path.join(root, 'docs/adr/README.md'), '# ADRs\n\n| # | Decision | Status |\n|---|---|---|\n| [0001](0001-first.md) | First | Accepted |\n\n## Numbers with no record\n\nNone.\n');
  writeFileSync(path.join(root, 'docs/adr/0001-first.md'), '# 1. First\n\n[back](README.md)\n');

  it('passes a healthy repository and skips dependencies', () => {
    const { code, lines } = run(root);
    assert.equal(code, 0, lines.join('\n'));
    assert.match(lines[0], /^3 Markdown files: every relative link resolves, the ADR index is complete and in order, every root licence is in the README\./);
  });

  it('reports a broken link with a file annotation', () => {
    writeFileSync(path.join(root, 'docs/extra.md'), '[gone](missing.md)\n');
    const { code, lines } = run(root);
    assert.equal(code, 1);
    assert.deepEqual(lines, ['::error file=docs/extra.md,line=1::`missing.md` does not resolve to a file in the repository.']);
  });

  it('honours skipDirs from the config, while the ADR check still reads the directory it is given', () => {
    const skipped = run(root, { config: { skipDirs: ['docs'] } });
    assert.equal(skipped.code, 0, 'the broken link under docs/ is no longer walked');
    assert.match(skipped.lines[0], /^1 Markdown files: every relative link resolves, the ADR index is complete and in order, every root licence/);
    const { lines } = run(root, { adrDir: 'nowhere', config: { skipDirs: ['docs'] } });
    assert.match(lines[0], /^1 Markdown files: every relative link resolves, every root licence is in the README\./);
  });

  it('holds the README to readmeMaxLines only when the config sets it', () => {
    const config = { skipDirs: ['docs'] };
    assert.doesNotMatch(run(root, { config }).lines[0], /lines/, 'unset: not checked');
    assert.match(run(root, { config: { ...config, readmeMaxLines: 3 } }).lines[0], /the README is within 3 lines\.$/);
    const { code, lines } = run(root, { config: { ...config, readmeMaxLines: 2 } });
    assert.equal(code, 1);
    assert.deepEqual(lines, ['::error file=README.md::README.md is 3 lines, over the limit of 2 (readmeMaxLines). Keep the fundamentals there and move the detail to docs/.']);
  });

  it('holds each file to maxLines only when the config sets it', () => {
    const config = { skipDirs: ['docs'] };
    assert.doesNotMatch(run(root, { config }).lines[0], /line limits/, 'unset: not checked');
    assert.match(run(root, { config: { ...config, maxLines: [{ glob: '**/*.md', max: 3 }] } }).lines[0], /, 1 files keep to their line limits\.$/);
    const { code, lines } = run(root, { config: { ...config, maxLines: [{ glob: 'README.md', max: 2, hint: 'Move it.' }] } });
    assert.equal(code, 1);
    assert.deepEqual(lines, ['::error file=README.md::README.md is 3 lines, over the limit of 2 for `README.md` (maxLines). Move it.']);
  });

  it('warns on STE words in the files that ste names, and still passes', () => {
    const ste = mkdtempSync(path.join(tmpdir(), 'docs-check-ste-'));
    mkdirSync(path.join(ste, 'docs/adr'), { recursive: true });
    writeFileSync(path.join(ste, 'README.md'), '# Repo\n\nIt works.\n');
    writeFileSync(path.join(ste, 'docs/guide.md'), '# Guide\n');
    writeFileSync(path.join(ste, 'docs/adr/0001-first.md'), '# 1. First\n\nIt should stay, because a record does not change.\n');
    writeFileSync(path.join(ste, 'docs/adr/README.md'), '| # | Decision | Status |\n|---|---|---|\n| [0001](0001-first.md) | First | Accepted |\n');
    assert.doesNotMatch(run(ste).lines.join('\n'), /STE/, 'unset: not checked');
    const clean = run(ste, { config: { ste: ['README.md', 'docs/*.md'] } });
    assert.equal(clean.code, 0);
    assert.match(clean.lines.at(-1), /, the STE word check read 2 files and warned on 0\.$/, 'docs/*.md does not reach docs/adr/');
    writeFileSync(path.join(ste, 'README.md'), '# Repo\n\nIt may work.\n');
    const warned = run(ste, { config: { ste: ['README.md'] } });
    assert.equal(warned.code, 0);
    assert.deepEqual(warned.lines.slice(0, 1), ['::warning file=README.md,line=3::"may" is not ASD-STE100. Write "can" for a possibility, or "must" for an obligation.']);
    assert.match(warned.lines.at(-1), /the STE word check read 1 file and warned on 1\.$/);
  });

  it('refuses an ste that is not a list of globs, so a typo cannot switch the check off', () => {
    for (const bad of ['README.md', [], [1], null]) {
      const { code, lines } = run(root, { config: { skipDirs: ['docs'], ste: bad } });
      assert.equal(code, 1);
      assert.match(lines[0], /^::error::ste must be a list of globs/);
    }
  });
});
