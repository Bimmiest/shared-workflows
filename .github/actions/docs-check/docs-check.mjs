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
 *   5. When the config sets `readmeMaxLines`, the root README is no longer
 *      than that: it keeps the fundamentals, and the detail lives in docs/.
 *   6. When the config sets `ste`, the files it names get a warning for each
 *      word that ASD-STE100 does not allow (#20). A warning, never a failure:
 *      a word list cannot judge a sentence.
 *   7. When the config sets `maxLines`, each Markdown file keeps to the limit
 *      of the first rule whose glob matches it (#49). A file over its limit
 *      can be listed under `maxLinesExceptions`, which caps it at its own
 *      `max` until it expires, and fails once the file is back within the rule.
 *   8. When the config sets `docTypes`, each topic file it names opens with
 *      YAML frontmatter whose `type` is one it allows (#51). A path says what
 *      a root file is for; only the file can say what a topic file is for.
 *      A `maxLines` rule can match on that `type` as well as on a glob.
 *   9. When the config sets `docsIndex`, its index file has one table row for
 *      each file it names, and no other, in path order (#55). The index is the
 *      one place a reader finds the topic files, so a file with no row is lost.
 *
 *   node docs-check.mjs [--root .] [--adr-dir docs/adr] [--config .docs-check.json]
 *
 * The optional config:
 *
 *   { "skipDirs": ["generated"],
 *     "knownDeadLinks": [ { "file": "docs/adr/0007-x.md", "target": "./0006-y.md", "reason": "…" } ],
 *     "readmeMaxLines": 200,
 *     "ste": ["README.md", "docs/*.md"],
 *     "maxLines": [ { "glob": "CHANGELOG.md", "max": null },
 *                   { "glob": "CONTRIBUTING.md", "max": 300, "hint": "Keep the rules here; move recipes to docs/." },
 *                   { "glob": "**\/*.md", "max": 500 } ],
 *     "maxLinesExceptions": [ { "file": "docs/big.md", "max": 900, "reason": "…", "issue": "#12", "expires": "2027-01-31" } ],
 *     "docTypes": { "glob": "docs/**\/*.md", "exclude": ["docs/adr/**"], "allowed": ["how-to", "reference"] },
 *     "docsIndex": { "file": "docs/README.md", "glob": "docs/**\/*.md", "exclude": ["docs/adr/[0-9]*.md"] } }
 *
 * Anchors are not checked, only the file a link names: a heading's slug is
 * the renderer's to decide, and a check that disagreed with GitHub's would be
 * red on links that work.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
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

/**
 * Why the README breaks the configured line limit, or null when it keeps to
 * it. A limit that is not a positive whole number is itself the problem, so a
 * typo in the config cannot turn the check off.
 */
export function readmeLengthProblem(readme, max) {
  if (!Number.isInteger(max) || max < 1) return `readmeMaxLines must be a positive whole number, not ${JSON.stringify(max)}.`;
  const lines = readme.replace(/\n$/, '').split('\n').length;
  if (lines <= max) return null;
  return `README.md is ${lines} lines, over the limit of ${max} (readmeMaxLines). Keep the fundamentals there and move the detail to docs/.`;
}

/** The number of lines in a text, not counting one final newline. */
const lineCount = (text) => text.replace(/\n$/, '').split('\n').length;

const isLimit = (max) => max === null || (Number.isInteger(max) && max >= 1);

const isStringList = (value, { empty = true } = {}) => Array.isArray(value) && (empty || value.length > 0) && value.every((item) => typeof item === 'string');

/** The `type` in the YAML frontmatter that opens a Markdown text, or null when there is none. */
export function frontmatterType(text) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!front) return null;
  const type = /^type:[ \t]*(["']?)([\w-]+)\1[ \t]*(?:#.*)?$/m.exec(front[1]);
  return type ? type[2] : null;
}

/**
 * Every topic file that `docTypes` names and whose frontmatter type is
 * missing or not allowed, as `{ file, problem }`, with `checked`. A malformed
 * config is itself a problem, so a typo cannot turn the check off.
 */
export function typeProblems(files, config) {
  const { glob, exclude = [], allowed } = config ?? {};
  if (typeof glob !== 'string' || !isStringList(exclude) || !isStringList(allowed, { empty: false })) {
    return Object.assign([{ file: null, problem: `docTypes must be { glob, exclude, allowed } with a string glob and lists of strings, not ${JSON.stringify(config)}.` }], { checked: 0 });
  }
  const problems = [];
  let checked = 0;
  for (const { file, text } of files) {
    if (!path.matchesGlob(file, glob) || exclude.some((pattern) => path.matchesGlob(file, pattern))) continue;
    checked++;
    const type = frontmatterType(text);
    const add = `Open the file with frontmatter that names one of ${allowed.join(', ')}: "---", "type: <type>", "---".`;
    if (type === null) problems.push({ file, problem: `${file} declares no type. ${add}` });
    else if (!allowed.includes(type)) problems.push({ file, problem: `${file} declares type "${type}", which docTypes does not allow. ${add}` });
  }
  return Object.assign(problems, { checked });
}

/**
 * Every way the docs index disagrees with the files it lists, as
 * `{ file, problem }`, with `listed`. A row is a table line whose first cell
 * links a file: `| [ci.md](ci.md) | … |`. Each file that `glob` names, less
 * `exclude` and the index itself, has one row, each row links such a file,
 * and the rows are in path order, case-insensitive.
 */
export function indexProblems(files, config) {
  const { file: index, glob, exclude = [] } = config ?? {};
  if (typeof index !== 'string' || typeof glob !== 'string' || !isStringList(exclude)) {
    return Object.assign([{ file: null, problem: `docsIndex must be { file, glob, exclude } with a string file and glob and a list of strings, not ${JSON.stringify(config)}.` }], { listed: 0 });
  }
  const entry = files.find(({ file }) => file === index);
  if (!entry) return Object.assign([{ file: null, problem: `docsIndex names ${index}, which does not exist. Create it, with a table row that links each file in ${glob}.` }], { listed: 0 });
  const wanted = new Set(files.map(({ file }) => file).filter((file) => file !== index && path.matchesGlob(file, glob) && !exclude.some((pattern) => path.matchesGlob(file, pattern))));
  const rows = [];
  stripCode(entry.text)
    .split('\n')
    .forEach((line, i) => {
      const match = /^\|\s*\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)/.exec(line);
      const target = match && resolveTarget(index, match[1]);
      if (target) rows.push({ line: i + 1, target, written: match[1] });
    });
  const problems = [];
  const fail = (line, problem) => problems.push({ file: index, problem: `${index}:${line}: ${problem}` });
  const seen = new Set();
  let previous = null;
  for (const row of rows) {
    if (seen.has(row.target)) fail(row.line, `${row.written} has a second row. Remove it.`);
    else if (!wanted.has(row.target)) fail(row.line, `the row links ${row.written}, which is not a file that docsIndex lists (${glob}). Remove the row, or link the file that it means.`);
    else if (previous && row.target.toLowerCase() < previous.target.toLowerCase()) fail(row.line, `${row.written} comes after ${previous.written}. Keep the rows in path order.`);
    seen.add(row.target);
    previous = row;
  }
  for (const file of [...wanted].sort()) {
    if (seen.has(file)) continue;
    const link = path.posix.relative(path.posix.dirname(index), file);
    problems.push({ file: index, problem: `${index} has no row for ${file}. Add "| [${link}](${link}) | what it holds |" in path order.` });
  }
  return Object.assign(problems, { listed: wanted.size });
}

/**
 * Every way the files break the `maxLines` rules, as `{ file, problem }`,
 * with `checked` (files held to a limit) and `excepted` (of those, the files
 * under an exception). A malformed rule or exception is itself a problem, so
 * a typo in the config cannot turn the check off. `today` is `YYYY-MM-DD`.
 */
export function lengthProblems(files, rules, exceptions = [], today = new Date().toISOString().slice(0, 10)) {
  const problems = [];
  const fail = (problem, file = null) => problems.push({ file, problem });
  if (!Array.isArray(rules) || rules.length === 0) {
    fail(`maxLines must be a list of { glob, max, hint } rules, not ${JSON.stringify(rules)}.`);
    return Object.assign(problems, { checked: 0, excepted: 0 });
  }
  const optionalString = (value) => value === undefined || typeof value === 'string';
  const valid = rules.filter((rule, index) => {
    if ((typeof rule?.glob === 'string' || typeof rule?.type === 'string') && optionalString(rule.glob) && optionalString(rule.type) && isLimit(rule.max) && optionalString(rule.hint)) return true;
    fail(`maxLines[${index}] must have a string glob or type (or both), a max that is a positive whole number or null, and an optional string hint, not ${JSON.stringify(rule)}.`);
    return false;
  });
  if (!Array.isArray(exceptions)) {
    fail(`maxLinesExceptions must be a list, not ${JSON.stringify(exceptions)}.`);
    exceptions = [];
  }
  const byFile = new Map();
  exceptions.forEach((entry, index) => {
    const missing = ['file', 'reason', 'issue', 'expires'].filter((key) => typeof entry?.[key] !== 'string' || entry[key].trim() === '');
    if (missing.length || !Number.isInteger(entry.max) || entry.max < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires)) {
      fail(`maxLinesExceptions[${index}] needs a file, a max that is a positive whole number, a reason, an issue and expires as YYYY-MM-DD, not ${JSON.stringify(entry)}.`);
    } else byFile.set(entry.file, entry);
  });

  let checked = 0;
  let excepted = 0;
  const used = new Set();
  for (const { file, text } of files) {
    const type = frontmatterType(text);
    const rule = valid.find((r) => (r.glob === undefined || path.matchesGlob(file, r.glob)) && (r.type === undefined || r.type === type));
    if (!rule || rule.max === null) continue;
    checked++;
    const lines = lineCount(text);
    const entry = byFile.get(file);
    const scope = [rule.glob !== undefined && `\`${rule.glob}\``, rule.type !== undefined && `type ${rule.type}`].filter(Boolean).join(', ');
    const limit = `the limit of ${rule.max} for ${scope} (maxLines)`;
    if (entry) {
      used.add(file);
      if (entry.expires < today) fail(`The maxLinesExceptions entry for ${file} expired on ${entry.expires}. The file is ${lines} lines, over ${limit}. Bring it within the limit, or argue the exception again with a new date (${entry.issue}).`, file);
      else if (lines <= rule.max) fail(`${file} is ${lines} lines, within ${limit}, so its maxLinesExceptions entry is no longer needed. Remove the entry.`, file);
      else if (lines > entry.max) fail(`${file} is ${lines} lines, over its maxLinesExceptions cap of ${entry.max}. The exception stops it from growing: move text out, not in (${entry.issue}).`, file);
      else excepted++;
    } else if (lines > rule.max) {
      fail(`${file} is ${lines} lines, over ${limit}. ${rule.hint ?? 'Split it, or move the detail to a topic file in docs/.'}`, file);
    }
  }
  for (const file of byFile.keys()) {
    if (!used.has(file)) fail(`maxLinesExceptions lists ${file}, but no Markdown file there is held to a limit. Remove the entry.`);
  }
  return Object.assign(problems, { checked, excepted });
}

/**
 * The words that ASD-STE100 does not allow, each with what to write instead.
 * Only the clear cases: a word that STE allows in one sense and not in
 * another ("may" the month, "close" the verb) would make every warning noise.
 */
export const STE_RULES = [
  [/\bshould\b/gi, 'Write "must" for an obligation, or "can" for a possibility.'],
  [/\b(?:may|might)\b/gi, 'Write "can" for a possibility, or "must" for an obligation.'],
  [/\bwould\b/gi, 'Write the simple present or the future: "is", "will".'],
  [/\b(?:e\.g\.|i\.e\.|etc\b\.?)/gi, 'Write "for example", "that is", or the complete list.'],
  [/\b(?:\w+n['’]t|\w+['’](?:re|ve|ll|m|d)|(?:it|that|there|here|what|let)['’]s)\b/gi, 'Write the two words in full.'],
  [/;/g, 'Write two sentences, or a list.'],
];

/**
 * The prose of a Markdown text, line count kept: code, HTML comments and
 * tags, entities and URLs are blanked, because none of them is text that STE
 * governs.
 */
export function prose(text) {
  const blank = (match) => match.replace(/[^\n]/g, ' ');
  return stripCode(text)
    .replace(/<!--[\s\S]*?(?:-->|$)/g, blank)
    .replace(/<[^>\n]+>|&#?\w+;|\]\([^)\n]*\)|\bhttps?:\/\/\S+/g, blank);
}

/** Every word in `text` that ASD-STE100 does not allow, as `{ line, word, advice }`. */
export function steWarnings(text) {
  const found = [];
  prose(text)
    .split('\n')
    .forEach((line, index) => {
      for (const [pattern, advice] of STE_RULES) {
        for (const match of line.matchAll(pattern)) found.push({ line: index + 1, word: match[0], advice });
      }
    });
  return found.sort((a, b) => a.line - b.line);
}

/** The lines to print and the exit code, for the repository at `root`. */
export function run(root, { adrDir = 'docs/adr', config = {}, today } = {}) {
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
    if (config.readmeMaxLines !== undefined) {
      const tooLong = readmeLengthProblem(readFileSync(path.join(root, 'README.md'), 'utf8'), config.readmeMaxLines);
      if (tooLong) problems.push(`::error file=README.md::${tooLong}`);
      else summary.push(`the README is within ${config.readmeMaxLines} lines`);
    }
  }
  if (config.maxLines !== undefined) {
    const long = lengthProblems(files, config.maxLines, config.maxLinesExceptions, today);
    problems.push(...long.map(({ file, problem }) => (file ? `::error file=${file}::${problem}` : `::error::${problem}`)));
    if (long.length === 0) summary.push(`${long.checked} files keep to their line limits${long.excepted ? ` (${long.excepted} under an exception)` : ''}`);
  }
  if (config.docTypes !== undefined) {
    const untyped = typeProblems(files, config.docTypes);
    problems.push(...untyped.map(({ file, problem }) => (file ? `::error file=${file}::${problem}` : `::error::${problem}`)));
    if (untyped.length === 0) summary.push(`${untyped.checked} topic files declare their type`);
  }
  if (config.docsIndex !== undefined) {
    const unindexed = indexProblems(files, config.docsIndex);
    problems.push(...unindexed.map(({ file, problem }) => (file ? `::error file=${file}::${problem}` : `::error::${problem}`)));
    if (unindexed.length === 0) summary.push(`${config.docsIndex.file} lists all ${unindexed.listed} files, in path order`);
  }
  const warnings = [];
  if (config.ste !== undefined) {
    if (!Array.isArray(config.ste) || config.ste.length === 0 || !config.ste.every((glob) => typeof glob === 'string')) {
      problems.push(`::error::ste must be a list of globs, not ${JSON.stringify(config.ste)}.`);
    } else {
      const named = files.filter(({ file }) => config.ste.some((glob) => path.matchesGlob(file, glob)));
      for (const { file, text } of named) {
        for (const { line, word, advice } of steWarnings(text)) {
          warnings.push(`::warning file=${file},line=${line}::"${word}" is not ASD-STE100. ${advice}`);
        }
      }
      summary.push(`the STE word check read ${named.length} file${named.length === 1 ? '' : 's'} and warned on ${warnings.length}`);
    }
  }
  if (problems.length === 0) return { lines: [...warnings, `${summary.join(', ')}.`], code: 0 };
  return { lines: [...problems, ...warnings], code: 1 };
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

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href) {
  process.exitCode = main();
}
