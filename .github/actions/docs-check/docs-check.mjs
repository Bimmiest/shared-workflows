#!/usr/bin/env node
/**
 * The documentation properties a reviewer cannot be trusted to notice
 * (propslab-ent #1601). Whether a paragraph is still true is a judgement;
 * these are facts, and each had already gone wrong once:
 *
 *   1. A relative link in any Markdown file resolves to a file or directory,
 *      except the dead links in ADR records listed under `knownDeadLinks`,
 *      which an immutable record keeps.
 *   2. Every `<adr-dir>/NNNN-*.md` has an index row in the ADR README, and
 *      every row a file; the rows are in ascending order.
 *   3. A number missing from the sequence is named under the README's
 *      "Numbers with no record" heading with a sentence saying why, and a
 *      number named there has no file, so the note cannot outlive its reason.
 *   4. Every `LICENSE-*` file at the root is linked from the README, whose
 *      licence section is where a reader learns what they may redistribute.
 *
 *   node docs-check.mjs [--root .] [--adr-dir docs/adr] [--config .docs-check.json]
 *
 * The optional config:
 *
 *   { "skipDirs": ["generated"],
 *     "knownDeadLinks": [ { "file": "docs/adr/0007-x.md", "target": "./0006-y.md", "reason": "…" } ] }
 *
 * Anchors are not checked, only the file a link names: a heading's slug is
 * the renderer's to decide, and a check that disagreed with GitHub's would be
 * red on links that work.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

/** Directories never walked: dependencies, build output, agent worktrees, and git itself. */
export const SKIP_DIRS = ['node_modules', '.git', '.claude', '.svelte-kit', 'coverage', 'dist', 'build', 'test-results', 'playwright-report', 'reports', '.stryker-tmp'];

/** The heading under which the ADR index accounts for a number with no file. */
export const GAP_HEADING = 'Numbers with no record';

/** Every `.md` file under `root`, as paths relative to it with `/` separators. */
export function markdownFiles(root, skip = new Set(SKIP_DIRS), dir = '') {
  const found = [];
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skip.has(entry.name)) found.push(...markdownFiles(root, skip, dir ? `${dir}/${entry.name}` : entry.name));
    } else if (entry.name.endsWith('.md')) {
      found.push(dir ? `${dir}/${entry.name}` : entry.name);
    }
  }
  return found.sort();
}

/**
 * Text with fenced code blocks and inline code spans blanked out, line count
 * preserved. A link inside code is an example of a link, not one.
 */
export function stripCode(text) {
  let fence = null;
  return text
    .split('\n')
    .map((line) => {
      const opener = /^\s*(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (opener && opener[1][0] === fence[0] && opener[1].length >= fence.length) fence = null;
        return '';
      }
      if (opener) {
        fence = opener[1];
        return '';
      }
      return line.replace(/(`+)[\s\S]*?\1/g, (span) => ' '.repeat(span.length));
    })
    .join('\n');
}

/**
 * Every link target in a Markdown text, with its line: inline `[x](target)`
 * and images, and reference definitions `[x]: target`. Titles and angle
 * brackets are removed; what is left is the destination as written.
 */
export function links(text) {
  const found = [];
  stripCode(text)
    .split('\n')
    .forEach((line, index) => {
      for (const match of line.matchAll(/\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)) {
        found.push({ line: index + 1, target: match[1].replace(/^<|>$/g, '') });
      }
      const definition = /^\s{0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/.exec(line);
      if (definition) found.push({ line: index + 1, target: definition[1].replace(/^<|>$/g, '') });
    });
  return found;
}

/**
 * The repository path a link names, or null when it names no file here: a
 * URL with a scheme, a protocol-relative URL, or an anchor in the same file.
 * A leading `/` is the repository root, as GitHub renders it.
 */
export function resolveTarget(file, target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//') || target.startsWith('#')) return null;
  const bare = target.split('#')[0].split('?')[0];
  if (!bare) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    decoded = bare;
  }
  return decoded.startsWith('/')
    ? path.posix.normalize(decoded.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(file), decoded));
}

/** Whether `file` is an ADR record, the only place a known dead link may live. */
const isRecord = (file, adrDir) => new RegExp(`^${adrDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\d{4}-[^/]+\\.md$`).test(file);

/**
 * Every relative link that does not resolve, as `{ file, line, target }`,
 * less the known dead links in ADR records, and, as `stale`, every known
 * entry that no longer describes a dead link in a record.
 */
export function brokenLinks(files, exists, { known = [], adrDir = 'docs/adr' } = {}) {
  const knownByKey = new Map(known.map((entry) => [`${entry.file} ${entry.target}`, entry]));
  const broken = [];
  const used = new Set();
  for (const { file, text } of files) {
    for (const { line, target } of links(text)) {
      const resolved = resolveTarget(file, target);
      if (resolved === null || (!resolved.startsWith('..') && exists(resolved))) continue;
      const key = `${file} ${target}`;
      if (isRecord(file, adrDir) && knownByKey.has(key)) {
        used.add(key);
        continue;
      }
      broken.push({ file, line, target });
    }
  }
  const stale = [...knownByKey.values()].filter(({ file, target }) => !used.has(`${file} ${target}`));
  return Object.assign(broken, { stale });
}

/** `0082-a-capture….md` → 82, for the record files in the ADR directory. */
export function adrFiles(names) {
  return names
    .map((name) => /^(\d{4})-.+\.md$/.exec(name))
    .filter(Boolean)
    .map((match) => ({ number: Number(match[1]), name: match[0] }));
}

/** The index table's rows, in the order they appear: `| [N](file) | … |`. */
export function indexRows(readme) {
  const rows = [];
  readme.split('\n').forEach((line, index) => {
    const match = /^\|\s*\[(\d+)\]\(([^)]+)\)\s*\|/.exec(line);
    if (match) rows.push({ line: index + 1, number: Number(match[1]), target: match[2] });
  });
  return rows;
}

/**
 * The numbers accounted for under the gap heading, each a bullet that opens
 * with the number in bold and carries a reason after it:
 * `- **81**: why it has no file.` A range, `**144–147**`, covers each number.
 */
export function gapNotes(readme) {
  const notes = new Map();
  let inside = false;
  readme.split('\n').forEach((line, index) => {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      inside = heading[1].trim() === GAP_HEADING;
      return;
    }
    if (!inside) return;
    const match = /^[-*]\s+\*\*(\d+)(?:\s*[–-]\s*(\d+))?\*\*\s*(?:[—–:-]\s*)?(.*)$/.exec(line);
    if (!match) return;
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    for (let n = from; n <= to; n++) notes.set(n, { line: index + 1, reason: match[3].trim() });
  });
  return notes;
}

/** Every way the ADR index disagrees with the directory, as sentences. */
export function adrProblems(names, readme, adrDir = 'docs/adr') {
  const problems = [];
  const files = adrFiles(names);
  const rows = indexRows(readme);
  const gaps = gapNotes(readme);
  const byNumber = new Map(files.map((f) => [f.number, f]));
  const rowNumbers = new Set(rows.map((r) => r.number));
  const index = `${adrDir}/README.md`;

  const seen = new Map();
  for (const file of files) {
    if (seen.has(file.number)) problems.push(`ADR ${file.number} has two files: ${seen.get(file.number)} and ${file.name}.`);
    seen.set(file.number, file.name);
  }
  for (const file of files) {
    if (!rowNumbers.has(file.number)) problems.push(`${adrDir}/${file.name} has no row in the index.`);
  }
  let previous = 0;
  for (const row of rows) {
    const file = byNumber.get(row.number);
    if (!file) problems.push(`${index}:${row.line}: the row for ADR ${row.number} names no file that exists.`);
    else if (row.target !== file.name) problems.push(`${index}:${row.line}: the row for ADR ${row.number} links ${row.target}, but the file is ${file.name}.`);
    if (row.number <= previous) problems.push(`${index}:${row.line}: ADR ${row.number} comes after ${previous}; the index is in ascending order.`);
    previous = Math.max(previous, row.number);
  }
  const highest = Math.max(0, ...files.map((f) => f.number));
  for (let n = 1; n <= highest; n++) {
    if (byNumber.has(n)) continue;
    const note = gaps.get(n);
    if (!note) problems.push(`ADR ${n} is missing from the sequence. Say why under "${GAP_HEADING}" in ${index}.`);
    else if (!note.reason) problems.push(`${index}:${note.line}: the note for ADR ${n} gives no reason.`);
  }
  for (const [n, note] of gaps) {
    if (byNumber.has(n)) problems.push(`${index}:${note.line}: ADR ${n} is noted as having no record, but it has one; remove the note.`);
  }
  return problems;
}

/** Every root `LICENSE-*` file the README does not link, as sentences. */
export function licenceProblems(rootNames, readme) {
  const linked = new Set(links(readme).map(({ target }) => resolveTarget('README.md', target)));
  return rootNames
    .filter((name) => /^LICENSE-/.test(name))
    .sort()
    .filter((name) => !linked.has(name))
    .map((name) => `README.md links no \`${name}\`. Add it to the licence section, with what it covers and what it obliges.`);
}

/** The lines to print and the exit code, for the repository at `root`. */
export function run(root, { adrDir = 'docs/adr', config = {} } = {}) {
  const exists = (relative) => {
    try {
      statSync(path.join(root, relative));
      return true;
    } catch {
      return false;
    }
  };
  const skip = new Set([...SKIP_DIRS, ...(config.skipDirs ?? [])]);
  const known = config.knownDeadLinks ?? [];
  const files = markdownFiles(root, skip).map((file) => ({ file, text: readFileSync(path.join(root, file), 'utf8') }));
  const broken = brokenLinks(files, exists, { known, adrDir });
  const problems = [
    ...broken.map(({ file, line, target }) => `::error file=${file},line=${line}::\`${target}\` does not resolve to a file in the repository.`),
    ...broken.stale.map(({ file, target }) => `::error::knownDeadLinks lists \`${target}\` in ${file}, but that is no longer a dead link in an ADR record. Remove the entry.`),
  ];
  const summary = [`${files.length} Markdown files: every relative link resolves${known.length ? ` (bar ${known.length} known dead in ADR records)` : ''}`];

  const adrPath = path.join(root, adrDir);
  if (existsSync(adrPath)) {
    const indexPath = path.join(adrPath, 'README.md');
    if (!existsSync(indexPath)) problems.push(`::error::${adrDir} has no README.md to index its records.`);
    else {
      problems.push(...adrProblems(readdirSync(adrPath), readFileSync(indexPath, 'utf8'), adrDir).map((p) => `::error::${p}`));
      summary.push('the ADR index is complete and in order');
    }
  }
  if (exists('README.md')) {
    problems.push(...licenceProblems(readdirSync(root), readFileSync(path.join(root, 'README.md'), 'utf8')).map((p) => `::error::${p}`));
    summary.push('every root licence is in the README');
  }
  if (problems.length === 0) return { lines: [`${summary.join(', ')}.`], code: 0 };
  return { lines: problems, code: 1 };
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: '.' },
      'adr-dir': { type: 'string', default: 'docs/adr' },
      config: { type: 'string', default: '.docs-check.json' },
    },
  });
  const root = path.resolve(values.root);
  const configPath = path.resolve(root, values.config);
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
  const { lines, code } = run(root, { adrDir: values['adr-dir'].replace(/\/+$/, ''), config });
  for (const line of lines) console.log(line);
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main();
}
