# 0003. The scripts have a coverage floor, from the Node test runner

- **Status:** Accepted
- **Date:** 2026-10-25
- **Issue:** [#19](https://github.com/Bimmiest/shared-workflows/issues/19)

## Context

[ADR 0002](0002-the-repository-follows-the-template-standard-without-a-toolchain.md)
gave this repository no coverage floor, because the template measures
coverage with Vitest and this repository has no Vitest. Thus the repository
that holds each consumer to a coverage floor had no floor of its own.

The Node test runner measures coverage with no dependency
(`--experimental-test-coverage`), and fails a run below a floor
(`--test-coverage-lines`, `--test-coverage-branches` and
`--test-coverage-functions`). On 2026-10-25 the scripts measured 96.24% of
lines, 91.36% of branches and 93.68% of functions.

## Decision

- `npm run test:coverage` runs the tests with the floors, and CI runs it.
  The floors are in `package.json`: 96, 91 and 93.
- The measurement includes only the scripts under `.github/actions/`, not
  the tests and not the fixtures that the tests write.
- When a change adds tests, the change raises the floors to the new
  measurement, rounded down.

This supersedes the two coverage bullets of ADR 0002. The rest of ADR 0002
stays.

## Consequences

- A change that removes tests, or adds a script with no test, fails CI.
- The floor holds one direction only. The `coverage-ratchet` action reads the
  coverage summary of Vitest, and the Node test runner does not write one.
  Thus nothing fails when the coverage goes above the floor, and a person
  must raise the floor. This is weaker than the rule for the consumers.
- The coverage flags are experimental in Node 24. If a Node release changes
  them, CI fails, and the fix is in `package.json`.
- What to check when you change it: if the Node test runner writes a summary
  that `coverage-ratchet` can read, use the action, and enforce both
  directions.
