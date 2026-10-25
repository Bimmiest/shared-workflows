# Security policy

## How to report a vulnerability

Report it privately through the
[private vulnerability reporting](https://github.com/Bimmiest/shared-workflows/security/advisories/new)
of GitHub: open the **Security** tab, then select **Report a vulnerability**.
Do not open a public issue for a security problem.

You get an acknowledgement within a week. If the report is valid, the fix
and the advisory are published together.

## What this repository is

This repository holds workflows and composite actions. Other repositories run
them in their own CI, with their own tokens. Nothing here runs on its own. A
consumer pins a commit of this repository, and runs it.

## In scope

- **A way for a pull request in a consumer to get more permissions than its
  job declares.** Examples are template injection through `${{ }}` in a
  `run:` block, a credential that stays in `.git/config`, and an action that
  a tag references.
- **A check that passes when it must fail.** The checks exist to refuse
  things. A way to make a check green while its condition is false is a
  finding.
- **A vulnerability in an action that this repository pins**, if a consumer
  can reach it. The pinned actions are `actions/*`,
  `gitleaks/gitleaks-action`, `aquasecurity/trivy-action` and
  `zizmorcore/zizmor-action`.

## Out of scope

- **Findings in the workflow files of a consumer.** They belong to that
  repository.
- **A convention that you think is wrong.** Open an issue for it. It is not a
  vulnerability.

## Supported versions

The newest tag on the `v1` line. A consumer pins a commit. A fix is released
as a new tag, and Dependabot brings it to each consumer.
