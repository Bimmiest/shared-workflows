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
