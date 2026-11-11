// The fixture that the mutation-ratchet step in ci.yml must fail. The report
// scores 83.33%, more than 1 point above the floor of 75.
export default {
  testRunner: 'vitest',
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
  reporters: ['clear-text', 'html', 'json'],
  thresholds: { high: 90, low: 85, break: 75 },
};
