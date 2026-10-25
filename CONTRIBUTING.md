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

## Scripts

- **Use plain Node, with no dependencies.** A script is importable for its
  test, and runnable as a command. The floor is Node 22, for
  `path.matchesGlob` and `parseArgs`.
- **Give each input through an argument or an environment variable.** Do not
  put `${{ }}` in a `run:` block. The inputs of a composite action are text
  that a caller wrote.
- **Each script has a `*.test.mjs` beside it**, which `node --test` runs. If
  a test does not hold a rule, the next edit can change the rule silently.
  `npm run test:coverage` fails below the floors in `package.json`. When a
  change adds tests, raise the floors to the new measurement, rounded down.
- **Each failure is an `::error::` line** that says what to change. A script
  returns its exit code from one function, so that the test can measure it in
  the same process.
- **An allowlist or exceptions file fails on an entry that nothing needs.**
  Thus the file cannot rot.
- **Each script-backed action has two fixtures** in `test/fixtures/`: one
  that must pass and one that must fail. The `actions` job in `ci.yml` runs
  the action on both, and fails if the second one passes. A new action gets
  its two fixtures in the same change.

## Pins

Each `uses:` is `owner/action@<40-hex SHA> # vX.Y.Z`. The owner of a tag can
move it while a job holds a checkout. Dependabot reads the comment, and
changes the SHA and the comment together. It reads `.github/workflows/` and
each `.github/actions/*/action.yml`. A container image, where you use one, is
`image@sha256:… # tag`, for the same reason.

In this repository, a workflow calls its own actions with `./`, not `$/`.
actionlint does not accept `$/` yet. `ci.yml` gives the detail.

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

**Write all documentation in ASD-STE100 Simplified Technical English**
(template [ADR 0002](https://github.com/Bimmiest/repo-template/blob/main/docs/adr/0002-documentation-is-simplified-technical-english-and-a-readme-keeps-to-the-fundamentals.md)).
This rule applies to each new or changed text. It does not apply to an
accepted ADR, or to third-party text such as the Contributor Covenant. The
main rules:

- One topic in each sentence, and one instruction in each procedure step.
- A maximum of 20 words in a procedure step, and 25 words in descriptive
  text. A maximum of six sentences in a paragraph.
- Use the active voice, and the imperative for an instruction.
- Do not use "-ing" forms, except in technical names.
- Use "must", "can" and "do not". Do not use `should`, `may`, `might` or
  `would`.
- Do not use phrasal verbs, contractions, semicolons in prose, or `e.g.`,
  `i.e.` and `etc.`. The docs check warns on these words in the files that
  `ste` names in `.docs-check.json`.
- Do not change code, commands, file names or product names.

**The README keeps to the fundamentals, in a maximum of 200 lines.** The
docs check enforces the limit, from `.docs-check.json`. Put each topic that
needs more than a few lines in `docs/`, and link it from the Documentation
table of the README. Do not use a wiki.

**A change updates the documents that it makes wrong, in the same change.**

| Document | Update it when |
|---|---|
| `CHANGELOG.md`, under `Unreleased` | A consumer gets something from the bump |
| `docs/catalogue.md` | An action or a workflow is added, or its inputs or its verdict change |
| `README.md` | The shape of the repository changes |
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
4. Tag the merge commit, and move the major tag to it:

   ```bash
   git tag -a vx.y.z <sha> -m "Release x.y.z"
   git tag -f vx <sha>
   git push origin vx.y.z
   git push -f origin vx
   ```

Dependabot proposes the bump in each consumer within the next week. The
cooldown is seven days on purpose.

The version follows the inputs, the outputs and the verdicts. A new input
with a default is a minor version. A check that fails on something that it
passed before is a major version, because the bump can make the `main` of
each consumer red.

## Repository layout

```
.github/
  workflows/
    security.yml         reusable
    workflow-lint.yml    reusable
    scorecard.yml        reusable
    ci.yml               the gates of this repository, which run the two above on it
    pr-hygiene.yml       the PR hygiene of this repository, from the action below
  actions/<name>/
    action.yml           the composite action
    <name>.mjs           the script that it runs, where there is one
    <name>.test.mjs      the tests of the script, which `npm test` runs
test/fixtures/           the projects that the actions job in ci.yml runs each action on
docs/                    the catalogue, how to consume the checks, the principles, the ADRs
```
