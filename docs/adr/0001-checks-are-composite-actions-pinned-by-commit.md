# 0001. Checks are composite actions, pinned by commit

- **Status:** Accepted
- **Date:** 2026-10-04, recorded on 2026-10-25
- **Issue:** [#12](https://github.com/Bimmiest/shared-workflows/issues/12)

## Context

This repository started on 2026-10-04, from the CI of `propslab` and
`propslab-ent`. The two repositories had the same checks in two copies, and
the copies drifted. The decision below was made then, and CONTRIBUTING
described it. This record was written when the repository moved to the
template standard ([#12](https://github.com/Bimmiest/shared-workflows/issues/12)).

GitHub gives two ways to share CI:

- A **reusable workflow** (`on: workflow_call`) is a complete job, with its
  own runner, permissions and timeout. A `uses:` inside it must name a fixed
  ref. Thus it cannot call a script or an action from this repository at the
  pin of the caller.
- A **composite action** is a step. GitHub gets the files of the action at
  the pin of the caller. Thus a script beside `action.yml` moves with it.

A consumer must also be able to read what it runs, and to know when it
changes. A tag can move while a job holds a checkout. A commit SHA cannot.

## Decision

- Each check that runs a script from this repository is a **composite
  action**, with the script beside its `action.yml`.
- A check that is a complete job and needs no file from this repository is a
  **reusable workflow**. `security.yml` and `workflow-lint.yml` are this shape.
- A consumer **pins a commit SHA**, with `# vX.Y.Z` after it. Each release
  gets a tag `vX.Y.Z` and moves a major tag `vX`. Dependabot reads the tags
  and the comment.
- **The version follows the verdicts.** A new input with a default is a
  minor version. A check that fails on something that it passed before is a
  major version.

## Consequences

- One fix here reaches each consumer at its next bump. A consumer sees each
  change as a pull request, and reads it before it merges.
- A consumer cannot run a newer check without a bump. A fix waits up to a
  week, because the cooldown of Dependabot is seven days.
- A composite action has no runner and no permissions of its own. The caller
  job gives both, so each caller must read the catalogue.
- Each release needs two tags, and the major tag moves with a force push.
- What to check when you change it: if GitHub lets a reusable workflow call
  an action at the pin of its caller, the script-backed checks can become
  reusable workflows.
