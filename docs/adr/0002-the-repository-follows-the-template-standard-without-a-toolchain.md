# 0002. The repository follows the template standard, without a toolchain

- **Status:** Accepted. The coverage bullets are superseded by [0003](0003-the-scripts-have-a-coverage-floor-from-the-node-test-runner.md).
- **Date:** 2026-10-25
- **Issue:** [#12](https://github.com/Bimmiest/shared-workflows/issues/12)

## Context

[`repo-template`](https://github.com/Bimmiest/repo-template) sets the
standard for the Bimmiest repositories: the governance files, the issue
forms, the CI gates, and the documentation standard of its
[ADR 0002](https://github.com/Bimmiest/repo-template/blob/main/docs/adr/0002-documentation-is-simplified-technical-english-and-a-readme-keeps-to-the-fundamentals.md).
propslab, propslab-sb and propslab-ent follow it. A convention lands in this
repository first, so this repository must follow the convention too.

Some parts of the template are for a TypeScript project with npm
dependencies. This repository has neither. Its scripts are plain Node, with
no dependencies and no lockfile, so that a consumer can run a check without
an install.

## Decision

This repository follows the template standard:

- Documentation in ASD-STE100, a README of 200 lines or fewer, and detail in
  `docs/*.md`. `.docs-check.json` sets the limit. The wiki is off.
- The governance files: CONTRIBUTING, `CLAUDE.md`, SECURITY, the Contributor
  Covenant, the issue forms, the pull request template and `docs/adr/`.
- The gates that apply: `pr-hygiene`, `docs-check`, `node-patch-check`,
  `security.yml` and `workflow-lint.yml`, on this repository.
- One exact Node version in `.nvmrc`, the same as the other repositories.

These parts of the template do not apply, because there is nothing for them
to check:

- **No ESLint, Prettier or TypeScript.** Each needs npm dependencies. The
  scripts are short, and `node --test` runs each one.
- **No coverage floor.** Vitest measures the coverage in the template, and
  this repository has no Vitest.
- **No `audit`, `licence-check` or `dependency-review` job.** There are no
  dependencies.

## Consequences

- A reader of any Bimmiest repository finds the same files in the same
  places, and this repository follows the rules that it enforces.
- A style mistake in a script gets no lint. Review finds it, or nobody does.
- If a branch of a script has no test, no coverage floor tells you.
  CONTRIBUTING requires a test for each script.
- What to check when you change it: if a script needs a dependency, add a
  `package-lock.json`, and then the audit, licence and lint gates apply.
  Record that in a new ADR.
