---
type: reference
---

# CI

Each workflow of this repository, what makes it fail, and where its rule is. [catalogue.md](catalogue.md) lists what the shared workflows and actions do for a consumer.

| Workflow and job | What makes it fail | Where the rule is |
|---|---|---|
| `ci.yml` `test` | A script test, a coverage floor, the docs check on this repository, or a `.nvmrc` that is behind its Node line | The `*.test.mjs` files, `package.json`, `.docs-check.json` |
| `ci.yml` `actions` | An action that fails its fixture that must pass, or passes its fixture that must fail | `test/fixtures/` |
| `ci.yml` `workflow-lint` | actionlint and zizmor findings in `.github/`, from this repository's own `workflow-lint.yml` | The workflows |
| `ci.yml` `security` | A secret anywhere in the history, or a fixable CRITICAL or HIGH finding, from this repository's own `security.yml` | `.gitleaks.toml`, `.trivyignore.yaml` |
| `ci.yml` `scorecard` | Nothing. It reports the OpenSSF Scorecard checks | The repository settings and the workflows |
| `pr-hygiene.yml` | A branch or an issue link that does not follow the convention | [CONTRIBUTING.md](../CONTRIBUTING.md#branches-commits-and-pull-requests) |
| `release.yml` | A change of `version` in `package.json` with no CHANGELOG section for it | [CONTRIBUTING.md](../CONTRIBUTING.md#releases) |
| `settings.yml` (weekly) | A repository setting that differs from the checklist of repo-template. A failure opens an issue | `.repo-settings.json` |

`ci.yml` also runs each Monday, so that a new advisory or a new Node patch shows on `main` without a pull request.
