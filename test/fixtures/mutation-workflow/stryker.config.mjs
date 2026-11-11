// The Stryker config of the run of mutation.yml in ci.yml. The workflow reads
// `mutate` and `thresholds.break` as text. The import names a package that is
// not installed, so the run fails if the workflow imports the config.
import { defineConfig } from 'not-installed';

export default defineConfig({
  testRunner: 'vitest',
  mutate: [
    'src/**/*.ts',
    // The tests are not mutated.
    '!src/**/*.test.ts',
  ],
  reporters: ['clear-text', 'html', 'json'],
  // Each file that stand-in-stryker.mjs mutates scores 75%. A shard has no
  // floor of its own: the score job holds the shards together to it.
  thresholds: { high: 90, low: 80, break: process.env.MUTATION_SHARD === '1' ? null : 75 },
});
