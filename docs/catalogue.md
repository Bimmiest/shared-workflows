# Catalogue

This file lists each workflow and action in this repository. Each
`action.yml` and each reusable workflow documents its inputs, with the
defaults. This file names only the inputs that a caller usually changes.

## Reusable workflows

A reusable workflow is a job. Call it under `jobs:` with `uses:`.

| Workflow | What it checks | What the caller gives it |
|---|---|---|
| [`security.yml`](../.github/workflows/security.yml) | gitleaks scans the full history for secrets. Trivy scans the tree for vulnerabilities and misconfiguration, at CRITICAL and HIGH. Trivy ignores a vulnerability that has no fix, and reads `.trivyignore.yaml` if the file exists. | `permissions: contents: read, pull-requests: read`. A `schedule` of its own, because both checks can fail with no push. |
| [`workflow-lint.yml`](../.github/workflows/workflow-lint.yml) | actionlint and zizmor read the `.github/` directory of the caller. | A runner with Go and shellcheck. `ubuntu-latest` has both. |
| [`scorecard.yml`](../.github/workflows/scorecard.yml) | OpenSSF Scorecard checks branch protection, token permissions, pinned dependencies, code review and the other Scorecard checks. It publishes the result for the badge, and uploads the findings to code scanning. It reports and does not fail. | `permissions: contents: read, actions: read, id-token: write, security-events: write`. A workflow of its own, on `push` to `main` and a weekly `schedule`, with no top-level `env`, `defaults` or write permission. A private repository sets `publish-results` and `upload-sarif` to `false`. |

`security.yml` and `workflow-lint.yml` take `runs-on` as a JSON array, with
the default `["ubuntu-latest"]`. Thus a caller can give the labels of a
self-hosted runner. `scorecard.yml` does not: Scorecard publishes only from a
runner that GitHub hosts. No workflow puts its jobs in a container. A repository on a
persistent runner that needs a job container keeps that job in its own
workflow. The `ci.yml` of `propslab-ent` is an example.

The check names are `<caller job> / <job>`. If the caller job is `security`,
the checks are `security / gitleaks` and `security / trivy`.

## Composite actions

A composite action is a step. Call it under `steps:` with `uses:`, after
`setup-node` or `setup-node-project`. The actions run the `node` that is on
the `PATH` of the runner, and they need Node 22 or later.

| Action | What it does | What it reads |
|---|---|---|
| [`setup-node-project`](../.github/actions/setup-node-project/action.yml) | Installs Node from `.nvmrc`, restores the npm cache, and runs `npm ci --ignore-scripts`. | `.nvmrc`, the lockfile |
| [`playwright-browser`](../.github/actions/playwright-browser/action.yml) | Installs one Playwright browser, cached on the resolved Playwright version. It installs the system packages on each run. | `@playwright/test` |
| [`coverage-ratchet`](../.github/actions/coverage-ratchet/action.yml) | Fails when a Vitest coverage floor is more than `slack` points below the measurement. The floors for each glob are included. It prints the block to write. | `vitest.config.ts`, `coverage/coverage-summary.json` |
| [`audit-check`](../.github/actions/audit-check/action.yml) | Runs `npm audit --omit=dev`, and fails at `high`. Each exception has a reason and an expiry. An exception that has expired, or that no advisory needs, fails. | `.audit-exceptions.json` |
| [`licence-check`](../.github/actions/licence-check/action.yml) | Fails when the licence of a production dependency is not on the allowlist. It reads the `license` fields of the lockfile, and installs nothing. | `.licence-allowlist.json`, `package-lock.json` |
| [`pr-hygiene`](../.github/actions/pr-hygiene/action.yml) | Fails when the branch is not `<type>/<short-description>-<issue>`, or the description does not link the issue. The `no-issue` label and `dependabot[bot]` are exempt. | The `pull_request` event |
| [`docs-check`](../.github/actions/docs-check/action.yml) | Fails on a relative Markdown link that does not resolve. Fails when the ADR index does not agree with `docs/adr/`, is not in order, or does not explain a gap. Fails when a root `LICENSE-*` file is not in the README. With `readmeMaxLines`, fails on a longer README. With `ste`, warns on each word that ASD-STE100 does not allow, in the files that `ste` names. | The Markdown files, `.docs-check.json` if it exists |
| [`node-patch-check`](../.github/actions/node-patch-check/action.yml) | Fails when `.nvmrc` is not the newest patch of its Node line. It asks nodejs.org. Use `warn-only` on a pull request. | `.nvmrc` |
| [`open-or-update-issue`](../.github/actions/open-or-update-issue/action.yml) | Keeps one open issue for each label, for a scheduled check. While the finding stays, it adds a comment to the issue. | The job needs `issues: write` |

## Inputs that callers change

| Action | Input | Default | Why a caller changes it |
|---|---|---|---|
| `setup-node-project` | `ignore-scripts` | `true` | A dependency needs its install script. Name the dependency in the workflow, with the reason. |
| `coverage-ratchet` | `slack` | `1` | Not usually. A larger slack lets the floor fall behind the measurement. |
| `audit-check` | `level` | `high` | Not usually. The level is the same in each repository on purpose. |
| `pr-hygiene` | `types` | `feature,fix,refactor,docs,ci,chore` | The repository uses a different list of branch types. |
| `node-patch-check` | `warn-only` | `false` | Set it to `true` on a pull request, so that a Node release does not block an unrelated change. |
| all script actions | `working-directory` | `.` | The project is in a subdirectory. |

## The commands behind the actions

Six actions run a script that is also a command. `npm` installs these `bin`
names: `audit-check`, `coverage-ratchet`, `docs-check`, `licence-check`,
`node-patch-check` and `pr-hygiene`. The arguments of a command are the same
as the arguments that the action gives. [consuming.md](consuming.md) tells you
how to run them.
