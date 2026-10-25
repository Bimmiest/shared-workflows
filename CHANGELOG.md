# Changelog

The changes to the shared workflows and actions, newest first. Each entry
says what a consumer gets when it bumps its pin.

---

## Unreleased

### Added

- **`changelog-check`, an action that fails a pull request that changes
  what a user can notice and not the changelog**
  ([#9](https://github.com/Bimmiest/shared-workflows/issues/9)). Give it the
  globs that need an entry in `paths`. The label `no-changelog` exempts a
  change that no user can see. It reads the changed files through the API,
  so it needs no checkout. On a private repository the job needs
  `pull-requests: read`.

## 1.2.0 — 2026-10-25

### Added

- **`scorecard.yml`, a reusable workflow for OpenSSF Scorecard**
  ([#15](https://github.com/Bimmiest/shared-workflows/issues/15)). Call it
  weekly and on push to `main`. It publishes the result for the README badge
  and uploads the findings to code scanning. It reports and does not fail.
  [docs/catalogue.md](docs/catalogue.md) lists the permissions and the limits
  of the caller workflow.

- **`repo-settings-check`, an action that compares the repository settings
  with the template checklist**
  ([#16](https://github.com/Bimmiest/shared-workflows/issues/16)). A template
  copies files, not settings, so a setting drifts with no commit. Run it
  weekly with a fine-grained token that has "Administration: read". Name the
  required checks of `main` in `.repo-settings.json`, and give each
  exception a reason, for example a private repository on the Free plan,
  which has no rulesets.

- **`docs-check` warns on words that ASD-STE100 does not allow**
  ([#20](https://github.com/Bimmiest/shared-workflows/issues/20)). Name the
  files in `.docs-check.json`, for example
  `"ste": ["README.md", "docs/*.md"]`. Each `should`, `may`, `might`,
  `would`, `e.g.`, `i.e.`, `etc.`, contraction and semicolon in prose gets a
  warning with what to write instead. Code, comments and URLs are not read.
  The check never fails, and it is off when `ste` is not set.

### Fixed

- **`pr-hygiene` counts only the links that a reader sees**
  ([#23](https://github.com/Bimmiest/shared-workflows/issues/23)). Before,
  a description could pass with a link that GitHub hides: in a comment that
  one pass of the filter made, or after an unclosed `<!--` at the start of a
  line. CodeQL found it.

### Changed

- **`workflow-lint.yml` runs zizmor through `zizmor-action` 0.7.1**
  ([#6](https://github.com/Bimmiest/shared-workflows/pull/6)). The zizmor
  version stays at the `zizmor-version` input, 1.30.1 by default.

## 1.1.0 — 2026-10-25

### Added

- **`docs-check` can hold the README to a line limit** ([#7](https://github.com/Bimmiest/shared-workflows/issues/7)). Set `"readmeMaxLines": 200` in `.docs-check.json`, and a README over that fails with its length and the limit. Unset, nothing is checked, so no consumer changes on the bump. A value that is not a positive whole number fails rather than switching the check off.

## 1.0.1 — 2026-10-25

### Fixed

- **The npx route runs the check** ([#4](https://github.com/Bimmiest/shared-workflows/issues/4)). Through `npx -y -p github:Bimmiest/shared-workflows#v1 <check>`, every script exited 0 without running, because its main guard compared the unresolved `.bin` symlink with the real file. A local run is now the check CI runs. The actions run the scripts by path and are unaffected.

### Changed

- **`setup-node-project` uses `actions/setup-node` 7.1.0**, which the workflows here already used. Dependabot now also watches the composite actions, whose pins it did not read before.

## 1.0.0 — 2026-10-04

The first release, distilled from the CI of `Bimmiest/propslab` and `Bimmiest/propslab-ent`.

### Reusable workflows

- **`security.yml`**: gitleaks over the whole history, and Trivy over the tree for vulnerabilities and misconfiguration, gated at CRITICAL and HIGH with unfixed advisories ignored.
- **`workflow-lint.yml`**: actionlint and zizmor over the caller's `.github/`.

### Composite actions

- **`setup-node-project`**: Node from `.nvmrc`, the npm cache, and `npm ci --ignore-scripts`.
- **`playwright-browser`**: one Playwright browser, cached on the resolved Playwright version.
- **`coverage-ratchet`**: fails when a vitest coverage floor sits more than a point under its measurement, per-glob thresholds included, and prints the block to write.
- **`audit-check`**: `npm audit` on production dependencies with a floor and an exceptions file whose entries expire.
- **`licence-check`**: every production dependency's licence is on the allowlist, read from the lockfile.
- **`pr-hygiene`**: the branch names a type and an issue, and the description links it.
- **`docs-check`**: relative Markdown links resolve, the ADR index agrees with its directory, numbering gaps are explained, root licences are in the README.
- **`node-patch-check`**: `.nvmrc` is the newest patch of its Node line.
- **`open-or-update-issue`**: one open issue per label for a scheduled check, commented on while the finding persists.
