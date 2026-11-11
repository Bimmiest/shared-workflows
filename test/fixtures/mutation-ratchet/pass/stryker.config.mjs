// The fixture that the mutation-ratchet step in ci.yml must pass. The report
// scores 83.33%: 20 detected of 24 counted mutants. The floor is 83. The
// import names a package that is not installed, so the step fails if the
// action imports the config rather than read it as text.
import { defineConfig } from 'not-installed';

export default defineConfig({
  testRunner: 'vitest',
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
  reporters: ['clear-text', 'html', 'json'],
  thresholds: { high: 90, low: 85, break: process.env.MUTATION_SHARD === '1' ? null : 83 },
});
