# Changelog

All notable changes to the shared workflows and actions, newest first. Entries say what a consuming repository gets from bumping its pin.

---

## Unreleased

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
