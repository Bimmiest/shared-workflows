// A stand-in for `stryker run`, for the run of mutation.yml in ci.yml. It
// writes a JSON report with four mutants for each file that it mutates: two
// killed, one timeout and one survivor, so each set of files scores 75%. As
// Stryker does, it fails on a file in --mutate that does not exist, so a wrong
// path or a wrong working directory fails the run. With no --mutate, it
// mutates what stryker.config.mjs selects: each .ts file in src/ that is not
// a test.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { mutate: { type: 'string' }, canary: { type: 'boolean', default: false } } });
if (values.canary) {
  console.log('Canary: the stand-in runs.');
  process.exit(0);
}
const files = values.mutate
  ? values.mutate.split(',')
  : readdirSync('src')
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map((file) => `src/${file}`);
const statuses = ['Killed', 'Killed', 'Timeout', 'Survived'];
const report = { schemaVersion: '2', thresholds: { high: 90, low: 80 }, files: {} };
for (const file of files) {
  if (!existsSync(file)) {
    console.error(`No such file to mutate: ${file}`);
    process.exit(1);
  }
  report.files[file] = {
    language: 'typescript',
    source: readFileSync(file, 'utf8'),
    mutants: statuses.map((status, i) => ({
      id: `${file}#${i}`,
      mutatorName: 'StandIn',
      replacement: '/* mutant */',
      status,
      location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
    })),
  };
}
mkdirSync('reports/mutation', { recursive: true });
writeFileSync('reports/mutation/mutation.json', `${JSON.stringify(report, null, 2)}\n`);
const floor = process.env.MUTATION_SHARD === '1' ? 'no floor (MUTATION_SHARD=1)' : 'the floor';
console.log(`Mutated ${files.length} files, with ${floor}: ${files.join(', ')}`);
