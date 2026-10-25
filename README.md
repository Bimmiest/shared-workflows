<p align="center">
  <img src="docs/assets/banner.svg" alt="shared-workflows" width="100%">
</p>

<p align="center">
  <a href="https://github.com/Bimmiest/shared-workflows/actions/workflows/ci.yml"><img src="https://github.com/Bimmiest/shared-workflows/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/Bimmiest/shared-workflows/tags"><img src="https://img.shields.io/github/v/tag/Bimmiest/shared-workflows?sort=semver&label=release" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-MIT-blue" alt="Licence: MIT"></a>
</p>

# shared-workflows

The CI checks that the Bimmiest repositories share, as GitHub reusable
workflows and composite actions.

## Highlights

- **One place for each check.** A fix lands here one time. Each repository
  gets the fix with its next pin bump.
- **Each failure tells you what to change.** A check writes `::error::`
  lines that name the file and the fix.
- **Exceptions do not rot.** Each exception has a reason, and often an expiry.
  A check fails on an exception that nothing needs.
- **Pinned by content.** A consumer pins a commit SHA. Dependabot moves the
  pin when a new release is tagged.
- **No dependencies.** Each script is plain Node, with its test beside it.
  You can run each check on your own machine.

## Overview

The checks come from the CI of
[`propslab`](https://github.com/Bimmiest/propslab) and
[`propslab-ent`](https://github.com/Bimmiest/SplunkToolkit-Ent). Somebody
wrote each check for one repository, and then the next repository needed it.
[`repo-template`](https://github.com/Bimmiest/repo-template) calls all of
them. To start a new repository, use the template, not this repository.

There are two shapes. A reusable workflow is a complete job. `security.yml`
runs gitleaks and Trivy, `workflow-lint.yml` runs actionlint and zizmor, and
`scorecard.yml` runs OpenSSF Scorecard.
A composite action is a step: the coverage ratchet, the advisory and licence
checks, PR hygiene, the documentation check, the Node patch check, the
repository settings check, and the steps that install Node and a Playwright
browser.
[ADR 0001](docs/adr/0001-checks-are-composite-actions-pinned-by-commit.md)
records why each check with a script is an action.

The releases are on the `v1` line. A check that starts to fail on something
that it passed before is a new major version. This repository is not a
general catalogue of actions. It holds only the checks that a second
Bimmiest repository runs without change.

## Demo

A check that fails tells you what to change. This is `docs-check` on a
repository with a broken link, an ADR with no index row, and a long README:

```console
$ npx -y -p github:Bimmiest/shared-workflows#v1 docs-check
::error file=docs/usage.md,line=3::`install.md` does not resolve to a file in the repository.
::error::docs/adr/0002-b.md has no row in the index.
::error file=README.md::README.md is 213 lines, over the limit of 200 (readmeMaxLines). Keep the fundamentals there and move the detail to docs/.
```

In a pull request, GitHub shows each `::error::` line as an annotation on the
file that it names.

## Usage

Call a reusable workflow as a job, and a composite action as a step. Pin a
commit SHA, and write the version in a comment after it. Dependabot reads the
comment.

```yaml
jobs:
  security:
    uses: Bimmiest/shared-workflows/.github/workflows/security.yml@<sha> # vX.Y.Z
    permissions:
      contents: read
      pull-requests: read

  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha> # vX.Y.Z
        with:
          persist-credentials: false
      - uses: Bimmiest/shared-workflows/.github/actions/setup-node-project@<sha> # vX.Y.Z
      - run: npm run test:coverage
      - uses: Bimmiest/shared-workflows/.github/actions/coverage-ratchet@<sha> # vX.Y.Z
```

[docs/catalogue.md](docs/catalogue.md) lists each workflow and action, and
what it needs from the caller.

## Installation

CI needs no installation: GitHub gets the commit that you pin. To run a check
on your own machine, use npx with the tag of your pin:

```bash
npx -y -p github:Bimmiest/shared-workflows#v1 coverage-ratchet --config vitest.config.ts
```

Requirements: Node 22 or later. [docs/consuming.md](docs/consuming.md) tells
you how to run a check from a clone, and how to update a pin.

## Documentation

| Document | What it holds |
|---|---|
| [docs/catalogue.md](docs/catalogue.md) | Each workflow and action: what it checks, what it reads, and what the caller gives it |
| [docs/consuming.md](docs/consuming.md) | How to pin, call and update the checks, and how to run them on your own machine |
| [docs/principles.md](docs/principles.md) | The rules that all the checks follow, and why |
| [docs/adr/](docs/adr/README.md) | The decisions, and why we made them |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to change a check, test it and release it |
| [CHANGELOG.md](CHANGELOG.md) | What a consumer gets from each release, newest first |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability, and what is in scope |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | The Contributor Covenant, enforced through the security contact |

## Contributing and feedback

To report a bug or to suggest a change, open an issue. Before you open a pull
request, read [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[MIT](LICENSE).
