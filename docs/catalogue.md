---
type: reference
---

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
| [`licence-check`](../.github/actions/licence-check/action.yml) | Fails when the licence of a production dependency is not on the allowlist. With `include-dev`, it also checks each devDependency. It reads the `license` fields of the lockfile, and installs nothing. | `.licence-allowlist.json`, `package-lock.json` |
| [`dependabot-review-facts`](../.github/actions/dependabot-review-facts/action.yml) | Writes the facts of a dependency update to a JSON file: the packages whose version changed, a 0.x minor move, each new nested copy, where the repository names each package, and the pull request's title and body. It runs nothing from the checkout. It never fails on what it finds. | `package-lock.json`, `fetch-depth: 2` |
| [`dependabot-review`](../.github/actions/dependabot-review/action.yml) | Sends the facts to the Messages API, and writes one comment on the pull request with a verdict and its reasons. The verdict is advice, and the step fails only when it cannot write the comment. [consuming.md](consuming.md#run-the-advisory-dependabot-review) has the workflow. | A federation rule and `id-token: write`, or an `api-key` secret. `pull-requests: write` |
| [`lockfile-nesting-check`](../.github/actions/lockfile-nesting-check/action.yml) | Warns, or fails with `level: fail`, when a pull request adds a nested copy of a package to the lockfile, and names the versions at the top level and in the copy. It needs the base: `fetch-depth: 2`, or the `base` input. | `package-lock.json` |
| [`package-contents-check`](../.github/actions/package-contents-check/action.yml) | Fails when `npm pack` leaves out a path that must ship, or ships a path that must not. The required paths are exact, and the forbidden ones are regular expressions. | `.package-contents.json` |
| [`lint-allowlist-check`](../.github/actions/lint-allowlist-check/action.yml) | Fails when a count in the lint allowlist is not what its rule finds. It lints each listed file with its listed rules on again, through the caller's ESLint. A higher count is new code, and a lower count is a fix that must lower the number. Run it after `npm ci`. | `scripts/lint-allowlist.json`, `eslint.config.js` |
| [`pr-hygiene`](../.github/actions/pr-hygiene/action.yml) | Fails when the branch is not `<type>/<short-description>-<issue>`, or the description does not link the issue. The `no-issue` label and `dependabot[bot]` are exempt. | The `pull_request` event |
| [`changelog-check`](../.github/actions/changelog-check/action.yml) | Fails when a pull request changes a file in `paths` and does not change `CHANGELOG.md`. Tests are ignored. The `no-changelog` label and `dependabot[bot]` are exempt. | The files of the pull request. On a private repository the job needs `pull-requests: read` |
| [`docs-check`](../.github/actions/docs-check/action.yml) | Fails on a relative Markdown link that does not resolve. Fails when the ADR index does not agree with `docs/adr/`, is not in order, or does not explain a gap. Fails when a root `LICENSE-*` file is not in the README. With `readmeMaxLines`, fails on a longer README. With `maxLines`, fails on each Markdown file that is longer than the first rule that matches it, less the files that `maxLinesExceptions` caps until a date. With `docTypes`, fails on a topic file whose frontmatter has no allowed `type`. With `docsIndex`, fails when the index of `docs/` has no row for a topic file, a row for no file, or rows out of path order. With `ste`, warns on each word that ASD-STE100 does not allow, in the files that `ste` names. | The Markdown files, `.docs-check.json` if it exists |
| [`node-patch-check`](../.github/actions/node-patch-check/action.yml) | Fails when `.nvmrc` is not the newest patch of its Node line. It asks nodejs.org. With `eol-days`, it also fails when the line ends in fewer days than that, from the Node release schedule. Use `warn-only` on a pull request. | `.nvmrc` |
| [`node-version-check`](../.github/actions/node-version-check/action.yml) | Fails when `.nvmrc` is not in the Node range of `devEngines.runtime` or `engines.node`. It also fails when the lower bound of the `devEngines` range is not on the major of `.nvmrc`. With `engines-major`, this rule also applies to `engines.node`. It skips a field that is not there, with a notice. A range can have `>=`, `>`, `<=`, `<`, `=`, `^`, `~` and a bare version, separated by spaces. Each other form fails. | `.nvmrc`, `package.json` |
| [`repo-settings-check`](../.github/actions/repo-settings-check/action.yml) | Fails when a repository setting differs from the checklist of `repo-template`: the merge methods and the squash body, branch deletion, the wiki, the Actions permissions and SHA pinning, fork approval, private vulnerability reporting, Dependabot alerts, secret scanning, push protection, and the ruleset on `main`. A setting that the token cannot read fails. Each exception has a reason, and an exception that nothing needs fails. | A `token` with "Administration: read", `.repo-settings.json` if it exists |
| [`baseline-check`](../.github/actions/baseline-check/action.yml) | Fails when the repository lacks a file of the baseline standard (`repo-template` `docs/standard.md`): the core set of its forge (the governance files, the issue forms, the workflows, the scanner and check configs, the ADR index), the docs index and the six topic files for a stack with code, and the Node toolchain files for `node-ts`. Each exception has a reason, and an exception for a file that exists fails. The lists are in the action, so a file added to a list is a major version. | `.baseline-exceptions.json` if it exists |
| [`open-or-update-issue`](../.github/actions/open-or-update-issue/action.yml) | Keeps one open issue for each label, for a scheduled check. While the finding stays, it adds a comment to the issue. | The job needs `issues: write` |

## Inputs that callers change

| Action | Input | Default | Why a caller changes it |
|---|---|---|---|
| `setup-node-project` | `ignore-scripts` | `true` | A dependency needs its install script. Name the dependency in the workflow, with the reason. |
| `coverage-ratchet` | `slack` | `1` | Not usually. A larger slack lets the floor fall behind the measurement. |
| `audit-check` | `level` | `high` | Not usually. The level is the same in each repository on purpose. |
| `licence-check` | `include-dev` | `false` | A bundler copies the devDependencies into what the repository ships, as in a SvelteKit app. Set it to `true`, and the check also reads them. |
| `pr-hygiene` | `types` | `feature,fix,refactor,docs,ci,chore` | The repository uses a different list of branch types. |
| `changelog-check` | `paths` | `src/**` | The files that a user gets are not in `src/`, for example the actions of this repository. |
| `node-patch-check` | `warn-only` | `false` | Set it to `true` on a pull request, so that a Node release does not block an unrelated change. |
| `node-patch-check` | `eol-days` | `0` (off) | Set it to `90`, so that a scheduled run fails before the Node line ends, and the move is filed as work. |
| `node-version-check` | `engines-major` | `false` | The repository is an app, and its `engines` gives its own toolchain. Set it to `true`. A library keeps `false`, because its `engines` gives the Node versions of its users. |
| `baseline-check` | `forge` | `github` | The repository is on Forgejo. The core set is then in `.forgejo/`, with `renovate.json` and no `LICENSE`. |
| `baseline-check` | `stacks` | empty | The repository is not only Node. Name each stack, space-separated, for example `rust node-ts`, or `gitops-config` for a repository with no documentation layer. Empty is the documentation layer, and the Node files where there is a `package-lock.json`. |
| `repo-settings-check` | `token` | none | Always. GITHUB_TOKEN cannot read most of the settings. Pass a secret, for example `SETTINGS_READ_TOKEN`. |
| all script actions | `working-directory` | `.` | The project is in a subdirectory. |

## The commands behind the actions

Fifteen actions run a script that is also a command. `npm` installs these
`bin` names: `audit-check`, `baseline-check`, `changelog-check`,
`coverage-ratchet`, `dependabot-review`, `dependabot-review-facts`,
`docs-check`, `licence-check`, `lint-allowlist-check`, `lockfile-nesting-check`, `node-patch-check`,
`node-version-check`, `package-contents-check`, `pr-hygiene` and `repo-settings-check`. The arguments of a command are the same as the
arguments that the action gives. [consuming.md](consuming.md) tells you how
to run them.
