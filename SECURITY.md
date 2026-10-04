# Security policy

## Reporting a vulnerability

Report privately through GitHub's [private vulnerability reporting](https://github.com/Bimmiest/shared-workflows/security/advisories/new): the **Security** tab, then **Report a vulnerability**. Please do not open a public issue for a security problem.

Expect an acknowledgement within a week. If a report is valid, the fix and the advisory go out together.

## What this repository is

Workflows and composite actions that other repositories run inside their own CI, with their own tokens. Nothing here runs on its own; a consumer pins a commit of this repository and executes it.

That makes the attack surface specific:

- **Anything that lets a pull request in a consuming repository run code with more than the permissions its job declares**: template injection through `${{ }}` in a `run:` block, a persisted credential, an action referenced by a mutable tag.
- **A check that passes when it should fail.** The gate scripts exist to refuse things; a way to make one return green without the condition it checks for holding is a finding.
- **A dependency of the pinned actions** this repository references (`actions/*`, `gitleaks/gitleaks-action`, `aquasecurity/trivy-action`, `zizmorcore/zizmor-action`) having a reachable vulnerability.

## Out of scope

- Findings in a consuming repository's own workflow files, which are that repository's.
- A convention this repository enforces being the wrong convention. That is an issue, not a vulnerability.

## Supported versions

The newest tag on the `v1` line. Consumers pin a commit; a fix is released as a new tag and arrives through Dependabot.
