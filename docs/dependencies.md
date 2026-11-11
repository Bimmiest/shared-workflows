---
type: reference
---

# Dependencies

The rules for what this repository depends on. CONTRIBUTING.md has the summary.

## Packages

This repository has no npm dependencies and no lockfile, so that a consumer runs a check with no install ([ADR 0002](adr/0002-the-repository-follows-the-template-standard-without-a-toolchain.md)). Do not add a dependency to a script.

## Pins

Each `uses:` is `owner/action@<40-hex SHA> # vX.Y.Z`. The owner of a tag can
move it while a job holds a checkout. Dependabot reads the comment, and
changes the SHA and the comment together. It reads `.github/workflows/` and
each `.github/actions/*/action.yml`. A container image, where you use one, is
`image@sha256:… # tag`, for the same reason.

In this repository, a workflow calls its own actions with `./`, not `$/`.
actionlint does not accept `$/` yet. [`ci.yml`](../.github/workflows/ci.yml) gives the detail.

A reusable workflow cannot call its own actions with `./`. In a reusable
workflow, `./` is a path in the checkout of the caller, so the step works in
the CI of this repository and fails in each consumer. Thus `mutation.yml`
calls `setup-node-project` pinned to a release, as `settings.yml` calls
`open-or-update-issue`, and Dependabot moves the pin. It gets its scripts at
the commit of its call
([ADR 0005](adr/0005-the-mutation-workflow-takes-its-scripts-from-the-commit-of-its-call.md)).
