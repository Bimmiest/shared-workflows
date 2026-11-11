/**
 * What the mutation scripts read from Stryker: the `mutate` list and
 * `thresholds.break` of the config, and the score of a JSON report (#37).
 *
 * The config is read as text, never imported. A consumer's config can import
 * packages that are not installed in a job that only reads it, and importing
 * it would also run its code. Thus only literal values are read: a `mutate`
 * list of string literals, and a `break` that is a number, `null`, or an
 * expression with one number in it, as in
 * `break: process.env.MUTATION_SHARD === '1' ? null : 81`.
 *
 * shortcut: the tokenizer does not know regular expression literals. A regex
 * with a quote or a comment marker in it, before `mutate` or `thresholds`,
 * misreads the rest of the file. Read the config with Stryker's own parser if
 * a consumer needs one.
 */

/** The statuses that Stryker counts as a test that noticed the mutant. */
export const DETECTED = ['Killed', 'Timeout'];

/** The statuses that Stryker counts as a test that did not notice it. */
export const UNDETECTED = ['Survived', 'NoCoverage'];

const ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };

/**
 * The tokens of JavaScript or JSON source, with no comments and no white
 * space. Each token is `{ type, value, start, end }`: `type` is `string`,
 * `template` (a template literal with a substitution), `number`, `name` or
 * `punct`. A string token's `value` is the text that it holds.
 */
export function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) {
      i += 1;
    } else if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
    } else if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) throw new Error('a /* comment has no */');
      i = end + 2;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      let value = '';
      let type = 'string';
      while (j < source.length && source[j] !== c) {
        if (source[j] === '\\') {
          value += ESCAPES[source[j + 1]] ?? source[j + 1] ?? '';
          j += 2;
        } else {
          if (c === '`' && source.startsWith('${', j)) type = 'template';
          value += source[j];
          j += 1;
        }
      }
      if (j >= source.length) throw new Error(`a string that starts with ${c} has no end`);
      tokens.push({ type, value, start: i, end: j + 1 });
      i = j + 1;
    } else {
      const number = /^(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i, i + 64));
      const name = number ? null : /^[A-Za-z_$][\w$]*/.exec(source.slice(i, i + 256));
      const text = number?.[0] ?? name?.[0] ?? c;
      tokens.push({ type: number ? 'number' : name ? 'name' : 'punct', value: text, start: i, end: i + text.length });
      i += text.length;
    }
  }
  return tokens;
}

/** Whether `token` is the key `key`: a name or a string, with a colon after it. */
const isKey = (tokens, index, key) =>
  (tokens[index].type === 'name' || tokens[index].type === 'string') &&
  tokens[index].value === key &&
  tokens[index + 1]?.value === ':';

/** The index of each place where `key` is a key, in `tokens` from `from` to `to`, at `depth` if one is given. */
function keyIndexes(tokens, key, { from = 0, to = tokens.length, depth } = {}) {
  const found = [];
  let level = 0;
  for (let i = from; i < to; i += 1) {
    const { type, value } = tokens[i];
    if (type === 'punct' && '([{'.includes(value)) level += 1;
    else if (type === 'punct' && ')]}'.includes(value)) level -= 1;
    else if ((depth === undefined || level === depth) && isKey(tokens, i, key)) found.push(i);
  }
  return found;
}

/** The index of the token that closes the bracket at `open`. */
function closing(tokens, open) {
  let level = 0;
  for (let i = open; i < tokens.length; i += 1) {
    const { type, value } = tokens[i];
    if (type !== 'punct') continue;
    if ('([{'.includes(value)) level += 1;
    else if (')]}'.includes(value)) {
      level -= 1;
      if (level === 0) return i;
    }
  }
  throw new Error(`the ${tokens[open].value} at character ${tokens[open].start} has no end`);
}

/** The one place where `key` is a key, or an Error that says why there is not one. */
function onlyKey(tokens, key, where, options) {
  const found = keyIndexes(tokens, key, options);
  if (found.length === 0) throw new Error(`${where} has no \`${key}\``);
  if (found.length > 1) throw new Error(`${where} has \`${key}\` ${found.length} times, and the scripts read one`);
  return found[0];
}

/**
 * The `mutate` list of a Stryker config, from its text. Throws an Error that
 * says what to change when the list is not there, or is not a literal list
 * of strings.
 */
export function readMutate(source, config = 'stryker.config.mjs') {
  const tokens = tokenize(source);
  const key = onlyKey(tokens, 'mutate', config);
  const open = key + 2;
  if (tokens[open]?.value !== '[') {
    throw new Error(`\`mutate\` in ${config} is not a list. Write it as a list of string literals, so that the scripts can read it without an import`);
  }
  const close = closing(tokens, open);
  const globs = [];
  for (let i = open + 1; i < close; i += 1) {
    const token = tokens[i];
    if (token.type === 'string') globs.push(token.value);
    else if (token.value !== ',') {
      throw new Error(
        `\`mutate\` in ${config} holds \`${source.slice(token.start, token.end)}\`, which is not a string literal. Write each glob as a string, so that the scripts can read the list without an import`,
      );
    }
  }
  return globs;
}

/**
 * `thresholds.break` of a Stryker config, from its text: `{ floor, text }`,
 * where `floor` is a number or null, and `text` is the expression as written.
 * An expression with one number and no arithmetic gives that number, so that
 * `process.env.MUTATION_SHARD === '1' ? null : 81` gives 81. Throws an Error
 * that says what to change for any other form.
 */
export function readBreak(source, config = 'stryker.config.mjs') {
  const tokens = tokenize(source);
  const key = onlyKey(tokens, 'thresholds', config);
  if (tokens[key + 2]?.value !== '{') throw new Error(`\`thresholds\` in ${config} is not an object literal`);
  const close = closing(tokens, key + 2);
  const at = onlyKey(tokens, 'break', `\`thresholds\` in ${config}`, { from: key + 3, to: close, depth: 0 });
  const value = [];
  let level = 0;
  for (let i = at + 2; i < close; i += 1) {
    const { type, value: text } = tokens[i];
    if (type === 'punct' && '([{'.includes(text)) level += 1;
    if (type === 'punct' && ')]}'.includes(text)) level -= 1;
    if (level === 0 && type === 'punct' && text === ',') break;
    value.push(tokens[i]);
  }
  if (value.length === 0) throw new Error(`\`thresholds.break\` in ${config} has no value`);
  const text = source.slice(value[0].start, value.at(-1).end);
  if (value.length === 1 && value[0].type === 'name' && value[0].value === 'null') return { floor: null, text };
  const numbers = value.filter((token) => token.type === 'number');
  const arithmetic = value.some((token) => token.type === 'punct' && '+-*/%'.includes(token.value));
  if (numbers.length !== 1 || arithmetic) {
    throw new Error(
      `\`thresholds.break\` in ${config} is \`${text}\`, which the scripts cannot read without an import. Write a number, or an expression with one number in it, such as \`process.env.MUTATION_SHARD === '1' ? null : 80\``,
    );
  }
  return { floor: Number(numbers[0].value.replace(/_/g, '')), text };
}

/**
 * Detected and counted mutants, as Stryker's mutation score counts them. A
 * timeout is a detection. A mutant that did not compile, failed at run time
 * or is ignored says nothing about the tests, so it does not count.
 */
export function tally(mutants) {
  const killed = mutants.filter((m) => DETECTED.includes(m.status)).length;
  const missed = mutants.filter((m) => UNDETECTED.includes(m.status)).length;
  return { killed, total: killed + missed };
}

/**
 * The score of the `files` of a report, in percent: `{ killed, total, score }`.
 * The score is null when no mutant counts, because Stryker gives no score then.
 */
export function score(files) {
  const { killed, total } = tally(Object.values(files ?? {}).flatMap((entry) => entry?.mutants ?? []));
  return { killed, total, score: total === 0 ? null : (100 * killed) / total };
}

/**
 * The files of several reports in one map. A file in two reports means that
 * two shards mutated it, and its mutants would count twice, so it throws.
 */
export function mergeFiles(reports) {
  const files = {};
  for (const report of reports) {
    for (const [path, entry] of Object.entries(report.files ?? {})) {
      if (Object.hasOwn(files, path)) throw new Error(`${path} is in two shard reports. Each file must be in one shard only.`);
      files[path] = entry;
    }
  }
  return files;
}

/** The artifact name of shard `shard` of `count`, which `shardCount` reads back. */
export const shardArtifact = (prefix, shard, count) => `${prefix}-${shard}-of-${count}`;

/**
 * The shard count of a run, from the names of its report directories, each
 * `<prefix>-<shard>-of-<count>`. A missing shard would raise the combined
 * score with no sign, so it throws, and so does a name from a run with a
 * different count or a name of another form.
 */
export function shardCount(names, prefix = 'mutation-report') {
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)-of-(\\d+)$`);
  const parsed = names.map((name) => {
    const match = pattern.exec(name);
    if (!match) {
      throw new Error(`${name} is not a shard report: expected ${shardArtifact(prefix, '<shard>', '<count>')}. Give each call of the workflow an artifact-name that is not the start of another.`);
    }
    return { shard: Number(match[1]), count: Number(match[2]) };
  });
  const count = parsed[0]?.count;
  if (count === undefined) throw new Error(`There are no shard reports named ${shardArtifact(prefix, '<shard>', '<count>')}.`);
  if (parsed.some((p) => p.count !== count)) throw new Error('The shard reports have different shard counts.');
  const missing = Array.from({ length: count }, (_, i) => i + 1).filter((i) => !parsed.some((p) => p.shard === i));
  if (missing.length > 0) throw new Error(`There is no report from shard ${missing.join(', ')} of ${count}.`);
  return count;
}
