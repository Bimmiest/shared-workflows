import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { adrProblems, brokenLinks, gapNotes, indexRows, licenceProblems, links, resolveTarget, run, stripCode } from './docs-check.mjs';

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
});
