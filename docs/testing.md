---
type: reference
---

# Tests

The rules for the tests of the scripts and the actions. CONTRIBUTING.md has the summary.

- **Each script has a `*.test.mjs` beside it**, which `node --test` runs. If
  a test does not hold a rule, the next edit can change the rule silently.
  `npm run test:coverage` fails below the floors in `package.json`. When a
  change adds tests, raise the floors to the new measurement, rounded down.
- **Each script-backed action has two fixtures** in `test/fixtures/`: one
  that must pass and one that must fail. The `actions` job in `ci.yml` runs
  the action on both, and fails if the second one passes. A new action gets
  its two fixtures in the same change.

The coverage floors are in the `test:coverage` script of `package.json` ([ADR 0003](adr/0003-the-scripts-have-a-coverage-floor-from-the-node-test-runner.md)).
