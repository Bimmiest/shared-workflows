# Contributing

This file is short on purpose: people do not apply a document that they do
not finish. Each rule gives its reason. When the reason is no longer true,
remove the rule. When a check enforces a rule, this file names the check.

The conventions come from
[`repo-template`](https://github.com/Bimmiest/repo-template). This repository
follows them, except where
[ADR 0002](docs/adr/0002-the-repository-follows-the-template-standard-without-a-toolchain.md)
says why not.

## Issues first

Before you write the code, open an issue for each change that is larger than
a typo. The issue is where people argue about the reason for a change, while
the change is still cheap. A closed issue is not a substitute: new work gets
a new issue.

An open question that must have an answer before the code is written is an
issue with the label `decision`. The answer becomes an ADR in `docs/adr/`.

## What belongs here

A workflow or an action belongs here when a second repository runs it without
change. A step that only one repository needs stays in that repository. The
test: if a consumer must fork the step to use it, the step is not shared yet.

[ADR 0001](docs/adr/0001-checks-are-composite-actions-pinned-by-commit.md)
gives the rule for the shape:

- **A reusable workflow** (`on: workflow_call`) is for a complete job, with
  its own runner, permissions and timeout, that needs no file from this
  repository except its YAML.
- **A composite action** (`.github/actions/<name>/action.yml`) is for a step,
  or for a check that runs a script from this repository.

## Scripts and tests

The rules and their reasons are in [docs/code-style.md](docs/code-style.md)
and [docs/testing.md](docs/testing.md). These are the rules that people break:

- **Use plain Node, with no dependencies.** A consumer runs a script with no
  install.
- **Each script has a `*.test.mjs` beside it, and each script-backed action
  has a fixture that must pass and one that must fail.** `npm test` proves
  the script. Only the fixtures prove the YAML around it.
- **Each failure is an `::error::` line that says what to change.**
- **A comment says why, for the code as it is now.** No lint checks the
  comments here, so check your own diff.

## Pins

**Pin each `uses:` to a full SHA, with `# vX.Y.Z` after it.** In this
repository, a workflow calls its own actions with `./`.
[docs/dependencies.md](docs/dependencies.md) gives the reasons, and why this
repository has no npm dependencies.

## Branches, commits and pull requests

- **Branches** are `<type>/<short-description>-<issue-number>`. The type is
  `feature`, `fix`, `refactor`, `docs`, `ci` or `chore`. The `pr-hygiene`
  action enforces the pattern here, as it does in each consumer. Add the
  label `no-issue` to a change that is the size of a typo.
- **Commits.** Write the subject in the imperative. In the body, say why, and
  say what the choice cost.
- **Before you open a pull request**, run `npm run test:coverage`. Then run
  each changed action or workflow from a branch of a consumer repository,
  pinned to the SHA of your branch. The unit tests prove the script. Only a
  real run proves the YAML around it.
- **CHANGELOG.** Under `Unreleased`, add one line that says what a consumer
  gets from the bump.

GitHub squash-merges a pull request, with the commit messages of the branch
as the body. Thus `main` keeps what you write when you commit.

## Documentation

**Write all documentation in ASD-STE100.** **Put each text in its class, and
keep the file within the limit of its class.** The docs check enforces the
limits, and each topic file in `docs/` declares its type.
[docs/documentation.md](docs/documentation.md) gives the classes, the limits,
the types and the STE rules. In short:

| Text | Where it goes |
|---|---|
| A rule that a contributor must follow | This file, in one or two sentences, with a link to the detail |
| The detail of a rule, a recipe, a trap or a troubleshooting step | The topic file of its area in `docs/` |
| What an action or a workflow does for a consumer | `docs/catalogue.md` |
| A decision that stays true after the pull request | A new ADR in `docs/adr/` |
| Work to do | An issue |
| What a consumer gets from a bump | `CHANGELOG.md`, under `Unreleased` |

**A change updates the documents that it makes wrong, in the same change.**

| Document | Update it when |
|---|---|
| `CHANGELOG.md`, under `Unreleased` | A consumer gets something from the bump |
| `docs/catalogue.md` | An action or a workflow is added, or its inputs or its verdict change |
| `README.md` | The shape of the repository changes |
| `docs/README.md` | A topic file is added, renamed or removed |
| `docs/adr/` | A decision stays true after the pull request: add a record **and** its index row |
| `SECURITY.md` | The attack surface changes |
| `CLAUDE.md` | People start to break a rule, or a mistake is expensive and not obvious |

## Releases

A consumer pins a commit SHA. The tag tells Dependabot that the commit has a
version, and tells a person what the pin is.

1. On a branch, change `Unreleased` in `CHANGELOG.md` to
   `## x.y.z — YYYY-MM-DD`. Add a new, empty `## Unreleased` above it.
2. Change `version` in `package.json` to `x.y.z`.
3. Open a pull request, and merge it when CI is green.

`release.yml` does the rest. It tags the merge commit `vx.y.z`, publishes a
GitHub Release with the CHANGELOG section, and moves `vx` to the same commit.
If the CHANGELOG has no section for the version, the workflow fails.

Do not tag a release by hand. A ruleset refuses to move or delete a `v*.*.*`
tag, and releases are immutable. Thus a wrong release cannot be corrected:
publish a new patch release
([ADR 0004](docs/adr/0004-a-workflow-publishes-each-release-and-a-release-tag-does-not-move.md)).

Dependabot proposes the bump in each consumer within the next week. The
cooldown is seven days on purpose.

The version follows the inputs, the outputs and the verdicts. A new input
with a default is a minor version. A check that fails on something that it
passed before is a major version, because the bump can make the `main` of
each consumer red.
